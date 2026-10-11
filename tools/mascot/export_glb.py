"""Export the mascot .blend to GLB without Blender (read-only on the source).
Applies object transforms + Mirror(X) modifiers, keeps UVs, baked texture, flat/smooth shading."""
import sys, struct, json, io, math
import numpy as np
sys.path.insert(0, '/home/claude/tools')
from blendparse import Blend
from PIL import Image

src, out, texout = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024
B = Blend(src)
CDL = B.tlen[B.types.index('CustomDataLayer')]

def layers(base):
    lp = B.get('CustomData', base, 'layers'); lb = B.deref(lp); res = {}
    if not lb: return res
    for i in range(lb[4]):
        la = lb[5] + i * CDL
        db = B.deref(B.get('CustomDataLayer', la, 'data'))
        if db: res[B.get('CustomDataLayer', la, 'name')] = (B.get('CustomDataLayer', la, 'type'), db)
    return res

def arr(db, dtype, comps):
    n = db[1] // np.dtype(dtype).itemsize
    return np.frombuffer(B.data, dtype=dtype, count=n, offset=db[5]).reshape(-1, comps) if comps > 1 else np.frombuffer(B.data, dtype=dtype, count=n, offset=db[5])

def eul_xyz(r):
    x, y, z = r
    Rx = np.array([[1,0,0],[0,math.cos(x),-math.sin(x)],[0,math.sin(x),math.cos(x)]])
    Ry = np.array([[math.cos(y),0,math.sin(y)],[0,1,0],[-math.sin(y),0,math.cos(y)]])
    Rz = np.array([[math.cos(z),-math.sin(z),0],[math.sin(z),math.cos(z),0],[0,0,1]])
    return Rz @ Ry @ Rx

def obmat(a):
    g = lambda f: np.array(B.get('Object', a, f), dtype=float)
    M = np.eye(4)
    M[:3, :3] = eul_xyz(g('rot') + g('drot')) @ np.diag(g('size') * g('dscale'))
    M[:3, 3] = g('loc') + g('dloc')
    return M

meshes = {b[2]: b for b in B.blocks if b[0] == 'ME'}
P, N, UV, MAT = [], [], [], []
PARTS = []
for b in B.blocks:
    if b[0] != 'OB' or B.get('Object', b[5], 'type') != 1: continue
    a = b[5]; mb = B.deref(B.get('Object', a, 'data')); m = mb[5]
    if B.get('Mesh', m, 'totvert') == 0: continue
    v = layers(B.get('Mesh', m, 'vdata')); l = layers(B.get('Mesh', m, 'ldata')); p = layers(B.get('Mesh', m, 'pdata'))
    pos = arr(v['position'][1], '<f4', 3).astype(float)
    cv = arr(l['.corner_vert'][1], '<i4', 1)
    uvname = [k for k, (t, _) in l.items() if t == 49 and not k.startswith('.')][0]
    uv = arr(l[uvname][1], '<f4', 2)
    offs = arr(B.deref(B.get('Mesh', m, 'poly_offset_indices')), '<i4', 1)
    npoly = B.get('Mesh', m, 'totpoly')
    sharp = arr(p['sharp_face'][1], 'u1', 1).astype(bool) if 'sharp_face' in p else np.zeros(npoly, bool)
    matidx = arr(p['material_index'][1], '<i4', 1) if 'material_index' in p else np.zeros(npoly, int)
    # material names of mesh slots
    n = B.get('Mesh', m, 'totcol'); mp = B.deref(B.get('Mesh', m, 'mat'))
    slots = [B.idname(B.deref(q))[2:] for q in struct.unpack_from('<%dQ' % n, B.data, mp[5])] if mp else []
    M = obmat(a)
    variants = [np.eye(4)]
    md = B.get('ListBase', B.get('Object', a, 'modifiers'), 'first')
    while md:
        x = B.deref(md)[5]
        if B.get('ModifierData', x, 'type') == 5:
            flag = B.get('MirrorModifierData', x, 'flag'); mo = B.get('MirrorModifierData', x, 'mirror_ob')
            new = []
            for ax, bit in ((0, 8), (1, 16), (2, 32)):
                if flag & bit:
                    S = np.eye(4); S[ax, ax] = -1
                    if mo:
                        T = np.linalg.inv(M) @ obmat(B.deref(mo)[5])
                        S = T @ S @ np.linalg.inv(T)
                    new += [S @ V for V in variants]
            variants += new
        md = B.get('ModifierData', x, 'next')
    for V in variants:
        W = M @ V; flip = np.linalg.det(W[:3, :3]) < 0
        wp = (np.c_[pos, np.ones(len(pos))] @ W.T)[:, :3]
        # smooth vertex normals
        vn = np.zeros_like(wp)
        tris = []
        for f in range(npoly):
            s, e = offs[f], offs[f + 1]
            idx = list(range(s, e))
            if flip: idx = idx[::-1]
            for k in range(1, len(idx) - 1):
                tris.append((idx[0], idx[k], idx[k + 1], f))
        tris = np.array(tris)
        c = tris[:, :3]
        a0, a1, a2 = wp[cv[c[:, 0]]], wp[cv[c[:, 1]]], wp[cv[c[:, 2]]]
        fn = np.cross(a1 - a0, a2 - a0)
        for k in range(3): np.add.at(vn, cv[c[:, k]], fn)
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
        fnn = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
        for k in range(3):
            pass
        corners = c.reshape(-1)
        P.append(wp[cv[corners]])
        nrm = np.where(np.repeat(sharp[tris[:, 3]], 3)[:, None], np.repeat(fnn, 3, axis=0), vn[cv[corners]])
        N.append(nrm)
        UV.append(uv[corners])
        MAT.append(np.repeat([slots[i] if i < len(slots) else slots[0] for i in matidx[tris[:, 3]]], 3))
        PARTS.append((B.idname(b)[2:], len(P[-1])))
    print(B.idname(b), 'variants', len(variants), 'tris', len(tris), 'bbox', wp.min(0).round(2), wp.max(0).round(2))

P = np.concatenate(P); N = np.concatenate(N); UV = np.concatenate(UV); MAT = np.concatenate(MAT)
# Blender Z-up -> glTF Y-up
P = P[:, [0, 2, 1]] * [1, 1, -1]; N = N[:, [0, 2, 1]] * [1, 1, -1]
UV = UV.copy(); UV[:, 1] = 1 - UV[:, 1]
print('total tris', len(P) // 3, 'bbox', P.min(0).round(3), P.max(0).round(3))

# texture
tb = [b for b in B.blocks if b[0] == 'IM' and B.get('ListBase', B.get('Image', b[5], 'packedfiles'), 'first')][0]
ipf = B.deref(B.get('ListBase', B.get('Image', tb[5], 'packedfiles'), 'first'))
pfb = B.deref(B.get('ImagePackedFile', ipf[5], 'packedfile'))
size = B.get('PackedFile', pfb[5], 'size'); db = B.deref(B.get('PackedFile', pfb[5], 'data'))
img = Image.open(io.BytesIO(B.data[db[5]:db[5] + size])).convert('RGB').resize((texout, texout), Image.LANCZOS)
tbuf = io.BytesIO(); img.save(tbuf, 'JPEG', quality=90); tex = tbuf.getvalue()

# build glb with two primitives (textured / black metal)
bin_ = bytearray(); views = []; accs = []
def add(data, target=None, comp='VEC3', minmax=False):
    data = np.ascontiguousarray(data, dtype='<f4')
    off = len(bin_); bin_.extend(data.tobytes())
    while len(bin_) % 4: bin_.append(0)
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': data.nbytes, **({'target': target} if target else {})})
    acc = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(data), 'type': comp}
    if minmax: acc['min'] = data.min(0).tolist(); acc['max'] = data.max(0).tolist()
    accs.append(acc); return len(accs) - 1
prims = []
for mi, mname in enumerate(['голова тело', 'Material']):
    sel = MAT == mname
    if not sel.any(): continue
    attrs = {'POSITION': add(P[sel], 34962, 'VEC3', True), 'NORMAL': add(N[sel], 34962)}
    if mname == 'голова тело': attrs['TEXCOORD_0'] = add(UV[sel], 34962, 'VEC2')
    prims.append({'attributes': attrs, 'material': mi})
off = len(bin_); bin_.extend(tex)
while len(bin_) % 4: bin_.append(0)
views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(tex)})
gl = {'asset': {'version': '2.0', 'generator': 'iam-blend-export'},
      'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'mascot'}],
      'meshes': [{'primitives': prims}],
      'materials': [{'name': 'body', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.5, 'roughnessFactor': 1.0}},
                    {'name': 'black_metal', 'pbrMetallicRoughness': {'baseColorFactor': [0.002, 0.002, 0.002, 1], 'metallicFactor': 1.0, 'roughnessFactor': 0.15}}],
      'textures': [{'source': 0}], 'images': [{'bufferView': len(views) - 1, 'mimeType': 'image/jpeg'}],
      'buffers': [{'byteLength': len(bin_)}], 'bufferViews': views, 'accessors': accs}
js = json.dumps(gl, ensure_ascii=False).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bin_
open(out, 'wb').write(glb)
# raw parts dump for the sprite baker
import json as _j
cnt=0; meta=[]
for nm,n in PARTS:
    meta.append({'name':nm,'start':cnt,'count':n}); cnt+=n
Pm=P; 
raw=np.concatenate([P.astype('<f4').ravel(),N.astype('<f4').ravel(),UV.astype('<f4').ravel(),(MAT=='Material').astype('<f4')])
open(out.replace('.glb','.bin'),'wb').write(raw.tobytes())
open(out.replace('.glb','.json'),'w').write(_j.dumps({'count':int(cnt),'parts':meta},ensure_ascii=False))
img.save(out.replace('.glb','_tex.jpg'),'JPEG',quality=90)
print('wrote', out, len(glb))
