"""Сквозной тест интерфейса в Chromium (браузерный режим с заглушкой ядра и мок-моделью).
Запуск: python3 -m http.server 8080 -d src & python3 tests/e2e/mock_llm.py 8799 & python3 tests/e2e/flow.py OUTDIR"""
import asyncio, sys, json
from playwright.async_api import async_playwright, expect
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
BASE = 'http://127.0.0.1:8080/'
results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name, extra)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1180, 'height': 760})
        errs = []
        def track(pg, n):
            pg.on('pageerror', lambda e: errs.append((n, str(e))))
            pg.on('console', lambda c: c.type == 'error' and '404' not in c.text and errs.append((n, c.text)))
        m = await ctx.new_page(); track(m, 'mascot')
        await m.clock.install()
        await m.goto(BASE + 'mascot.html'); await m.wait_for_timeout(800)
        pg = await ctx.new_page(); track(pg, 'main')
        await pg.goto(BASE + 'index.html'); await pg.wait_for_timeout(800)

        # ---- мастер первого запуска ----
        await pg.fill('#wizBody input', 'Тимофей'); await pg.click('text=Дальше')
        await pg.screenshot(path=OUT + '/w2.png')
        await pg.click('label.opt:has-text("Сбалансированная")')
        await pg.click('text=Скачать и дальше'); await pg.click('text=Да, включить')
        await pg.click('#wizBody >> text=Готово'); await pg.wait_for_timeout(700)
        s = json.loads(await pg.evaluate("localStorage.getItem('iam:settings')"))
        ok('мастер сохранил имя и firstRunDone', s['userName'] == 'Тимофей' and s['firstRunDone'])
        models = await pg.evaluate("localStorage.getItem('iam:mock-models')")
        ok('модель «скачана» (заглушка)', 'gemma-4-E2B' in (models or ''))

        # ---- задачи ----
        for t in ['Подготовить бриф для клиники', 'Сверстать лендинг', 'Позвонить в типографию']:
            await pg.fill('#taskInput', t); await pg.press('#taskInput', 'Enter')
        await pg.wait_for_timeout(300)
        ok('3 задачи в списке', await pg.locator('.task').count() == 3)
        await pg.hover('.task >> nth=1'); await pg.click('.task >> nth=1 >> [title="Сделать текущей"]')
        await pg.wait_for_timeout(200)
        ok('текущая задача выбрана', 'Сверстать лендинг' in await pg.inner_text('#currentTask'))
        await pg.click('.task >> nth=2 >> input.check'); await pg.wait_for_timeout(400)
        ok('задача отмечена выполненной', await pg.locator('.task.done').count() == 1)
        await m.wait_for_timeout(300)
        ok('маскот хвалит за выполненную задачу', not await m.locator('#bubble').is_hidden())

        # ---- команды в чате (без ИИ) ----
        async def say(text, wait=500):
            await pg.fill('#chatInput', text); await pg.press('#chatInput', 'Enter'); await pg.wait_for_timeout(wait)
        await say('напомни через 1 минуту выпить воды')
        last = await pg.locator('.msg.app').last.inner_text()
        ok('напоминание из чата сохранено', 'СОХРАНЕНО' in last.upper() or 'выпить воды' in last.lower(), last)
        st = json.loads(await pg.evaluate("localStorage.getItem('iam:state')"))
        ok('напоминание действительно в данных', any(c['text'] == 'Выпить воды' for c in st['sched']['custom']))
        await say('добавь задачу отправить счёт')
        ok('задача из чата добавлена', await pg.locator('.task:has-text("Отправить счёт")').count() == 1)
        await say('я сделал бриф для клиники')
        ok('задача отмечена из чата', await pg.locator('.task.done:has-text("бриф")').count() == 1)
        await say('запусти таймер на 50 минут')
        ok('таймер запущен из чата', '50:00' in await pg.inner_text('#timerDigits') or '49:5' in await pg.inner_text('#timerDigits'))
        await say('стоп таймер')
        await pg.screenshot(path=OUT + '/main_chat_cmds.png')

        # ---- свободный чат с моделью (мок) ----
        await say('привет! как дела?', 2500)
        ok('ответ модели получен', 'Привет' in await pg.locator('.msg.assistant').last.inner_text())
        await say('назначь созвон с клиентом', 2500)
        txt = await pg.locator('.msg.assistant').last.inner_text()
        ok('ложное «поставил напоминание» убрано', 'поставил' not in txt, txt)
        ok('карточка подтверждения показана', await pg.locator('.action-card').count() >= 1)
        st = json.loads(await pg.evaluate("localStorage.getItem('iam:state')"))
        ok('до подтверждения напоминание НЕ сохранено', not any(c['text'] == 'Созвон с клиентом' for c in st['sched']['custom']))
        await pg.click('.action-card >> text=Подтвердить'); await pg.wait_for_timeout(400)
        st = json.loads(await pg.evaluate("localStorage.getItem('iam:state')"))
        ok('после подтверждения сохранено', any(c['text'] == 'Созвон с клиентом' for c in st['sched']['custom']))
        await pg.screenshot(path=OUT + '/main_chat_llm.png')
        # остановка генерации
        await pg.fill('#chatInput', 'расскажи долго'); await pg.press('#chatInput', 'Enter'); await pg.wait_for_timeout(400)
        ok('кнопка «Стоп» видна во время генерации', await pg.is_visible('#stopBtn'))
        await pg.click('#stopBtn'); await pg.wait_for_timeout(400)
        ok('генерация остановлена', '[остановлено]' in await pg.locator('.msg.assistant').last.inner_text())
        # разбить на шаги
        await pg.hover('.task:has-text("Сверстать")'); await pg.click('.task:has-text("Сверстать") >> [title="Разбить на шаги (ИИ)"]'); await pg.wait_for_timeout(2500)
        await pg.click('.action-card:has-text("шаги") >> text=Подтвердить'); await pg.wait_for_timeout(400)
        ok('шаги добавлены подзадачами', await pg.locator('.task.sub').count() == 4)
        await pg.screenshot(path=OUT + '/main_steps.png')

        # ---- сохранение после перезапуска ----
        await pg.reload(); await pg.wait_for_timeout(800)
        ok('задачи сохранились после перезапуска', await pg.locator('.task').count() >= 8)
        ok('история чата сохранилась', await pg.locator('.msg').count() > 5)

        # ---- напоминание срабатывает в маскоте ----
        await m.clock.fast_forward('02:30'); await m.wait_for_timeout(600)
        bubble = await m.inner_text('#bubble') if not await m.locator('#bubble').is_hidden() else ''
        ok('напоминание показано маскотом', 'Выпить воды' in bubble, bubble.replace('\n', ' | '))
        await m.screenshot(path=OUT + '/mascot_reminder.png', clip={'x': 760, 'y': 340, 'width': 420, 'height': 420})
        await m.click('#bubble >> text=+10 мин'); await m.wait_for_timeout(300)
        st = json.loads(await m.evaluate("localStorage.getItem('iam:state')"))
        snoozed = [c for c in st['sched']['custom'] if c['text'] == 'Выпить воды'][0]
        ok('напоминание отложено на 10 минут', not snoozed['done'])

        # ---- «Не беспокоить» ----
        await say('не беспокой 1 час')
        await m.wait_for_timeout(300)
        await m.clock.fast_forward('11:00'); await m.wait_for_timeout(600)
        hidden = await m.locator('#bubble').is_hidden() or 'Выпить' not in await m.inner_text('#bubble')
        ok('в «Не беспокоить» напоминание не показано', hidden)
        await m.screenshot(path=OUT + '/mascot_dnd.png', clip={'x': 760, 'y': 340, 'width': 420, 'height': 420})

        # ---- настройки ----
        await pg.click('.tabs >> text=Настройки'); await pg.wait_for_timeout(600)
        await pg.screenshot(path=OUT + '/settings_top.png')
        await pg.click('.snav >> text=Модель ИИ'); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT + '/settings_model.png')
        await pg.click('.snav >> text=Система'); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT + '/settings_system.png')
        # маскот: панель
        await m.hover('#sprite'); await m.wait_for_timeout(300)
        await m.screenshot(path=OUT + '/mascot_panel.png', clip={'x': 700, 'y': 340, 'width': 480, 'height': 420})
        # узкое окно
        await pg.set_viewport_size({'width': 600, 'height': 800}); await pg.click('.tabs >> text=Чат'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT + '/main_narrow.png')
        ok('нет ошибок JS', not errs, str(errs[:5]))
        await b.close()
    print(f"\n{sum(r[1] for r in results)}/{len(results)} проверок пройдено")
asyncio.run(main())
