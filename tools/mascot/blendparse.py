"""Minimal read-only .blend (v4.x, 64-bit LE, uncompressed) parser."""
import struct, sys

class Blend:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        d = self.data
        assert d[:7] == b'BLENDER' and d[7:8] == b'-' and d[8:9] == b'v'
        self.version = d[9:12].decode()
        off = 12
        self.blocks = []
        while off < len(d):
            code = d[off:off+4]
            size, = struct.unpack_from('<i', d, off+4)
            ptr, = struct.unpack_from('<Q', d, off+8)
            sdna, count = struct.unpack_from('<ii', d, off+16)
            self.blocks.append((code.rstrip(b'\0').decode('latin1'), size, ptr, sdna, count, off+24))
            off += 24 + size
            if code == b'ENDB': break
        self.byptr = {b[2]: b for b in self.blocks}
        self._parse_dna()

    def _parse_dna(self):
        b = [x for x in self.blocks if x[0] == 'DNA1'][0]
        d = self.data; o = b[5]
        assert d[o:o+4] == b'SDNA'; o += 4
        def names_sec(o, tag):
            assert d[o:o+4] == tag, (d[o:o+4], tag); o += 4
            n, = struct.unpack_from('<i', d, o); o += 4
            out = []
            for _ in range(n):
                e = d.index(b'\0', o); out.append(d[o:e].decode('latin1')); o = e+1
            return out, o
        self.names, o = names_sec(o, b'NAME'); o = (o+3)&~3
        self.types, o = names_sec(o, b'TYPE'); o = (o+3)&~3
        assert d[o:o+4] == b'TLEN'; o += 4
        self.tlen = list(struct.unpack_from('<%dh' % len(self.types), d, o)); o += 2*len(self.types); o = (o+3)&~3
        assert d[o:o+4] == b'STRC'; o += 4
        n, = struct.unpack_from('<i', d, o); o += 4
        self.structs = []
        for _ in range(n):
            t, nf = struct.unpack_from('<hh', d, o); o += 4
            fields = []
            for _ in range(nf):
                ft, fn = struct.unpack_from('<hh', d, o); o += 4
                fields.append((self.types[ft], self.names[fn]))
            self.structs.append((self.types[t], fields))
        self.struct_by_name = {s[0]: i for i, s in enumerate(self.structs)}
        # compute offsets
        self.layout = {}
        for i, (tn, fields) in enumerate(self.structs):
            off = 0; lay = {}
            for ft, fn in fields:
                sz = self.field_size(ft, fn)
                key = fn.lstrip('*').split('[')[0].strip('()').lstrip('*')
                lay[key] = (off, ft, fn, sz)
                off += sz
            self.layout[tn] = lay

    def field_size(self, ft, fn):
        import re
        arr = 1
        for m in re.findall(r'\[(\d+)\]', fn): arr *= int(m)
        if fn.startswith('*') or fn.startswith('(*'):
            return 8 * arr
        return self.tlen[self.types.index(ft)] * arr

    def get(self, structname, base, field):
        off, ft, fn, sz = self.layout[structname][field]
        d = self.data; p = base + off
        if fn.startswith('*') or fn.startswith('(*'):
            if '[' in fn:
                return struct.unpack_from('<%dQ' % (sz//8), d, p)
            return struct.unpack_from('<Q', d, p)[0]
        fmt = {'char': 'b', 'uchar': 'B', 'short': 'h', 'ushort': 'H', 'int': 'i', 'uint': 'I',
               'float': 'f', 'double': 'd', 'int64_t': 'q', 'uint64_t': 'Q', 'int8_t': 'b', 'uint8_t': 'B',
               'int16_t': 'h', 'uint16_t': 'H', 'int32_t': 'i', 'uint32_t': 'I'}.get(ft)
        if ft == 'char' and '[' in fn:
            raw = d[p:p+sz]; return raw.split(b'\0')[0].decode('utf8', 'replace')
        if fmt is None:
            return p  # nested struct: return address
        n = sz // struct.calcsize(fmt)
        v = struct.unpack_from('<%d%s' % (n, fmt), d, p)
        return v[0] if n == 1 else v

    def block_type(self, b):
        return self.structs[b[3]][0]

    def idname(self, b):
        return self.get('ID', b[5], 'name')

    def deref(self, ptr):
        return self.byptr.get(ptr)

if __name__ == '__main__':
    bl = Blend(sys.argv[1])
    print('version', bl.version, 'blocks', len(bl.blocks))
    from collections import Counter
    print(Counter(b[0] for b in bl.blocks).most_common(40))
    for b in bl.blocks:
        if len(b[0]) == 2 and b[0] not in ('DATA',):
            try: print(b[0], bl.block_type(b), repr(bl.idname(b)))
            except Exception as e: print(b[0], 'err', e)
