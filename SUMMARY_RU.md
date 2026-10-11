# Ежедневный отчет о разработке — Tactical Pulse
**Дата:** 11 октября 2026 г.  
**Активная ветка:** `dev`  
**Репозиторий:** `tactical_pulse`

---

## 1. Общий обзор
Сегодня были завершены масштабные работы по развитию тактической системы оперативного управления (C2) Tactical Pulse. Основной упор сделан на совершенствовании интерактивной тактической карты (Frontend), оптимизации пространственных вычислений и обработки тревог (Backend), внедрении автономного симулятора движения подразделений и БПЛА, а также добавлении модуля регистрации сил и штабов.

Строго соблюдено требование по сохранению целостности серверной части: все интерфейсные доработки реализованы на клиенте (Frontend) без нарушения контракта API или изменения кода Backend.

---

## 2. Основные технические результаты по направлениям

### А. Тактическая карта и динамическое масштабирование (Frontend)
1. **Динамический автофокус с исключением статических штабов (Dynamic Sector Auto-Fit):**
   - **Исключение статических объектов:** Региональные штабы (`AreaCommandCenter`) и главный штаб (`MainCommandCenter`) определены как статические базы и исключены из расчета ограничивающего прямоугольника (`Bounding Box`). Камера ориентируется исключительно на динамические силы (`Squad`, `SapperSquad`, `Radar`) и активные тревоги/инциденты (`threats`).
   - **Точный охват сектора без пустых зон:**
     - Для Центрального командования (или группы внутри сектора): если силы расположены на северной и южной окраинах Нетании, масштаб охватывает строго диапазон между крайними точками Нетании, игнорируя пустое пространство вокруг.
     - При появлении угрозы или силы вблизи границы с Иорданией обзор Центрального командования автоматически расширяется, чтобы включить как Нетанию, так и границу.
     - Для Главного командования (`MainCommandCenter`): при наличии инцидентов/сил в Нетании и Эйлате обзор автоматически охватывает весь театр военных действий от Эйлата до Нетании.
   - **Отказ от жестких рамок по умолчанию:** Убрана статическая привязка к фиксированным границам при загрузке карты. Камера сразу же центрируется на активных оперативных объектах.

2. **Прикрепленное всплывающее окно данных силы ("Prop" Popup):**
   - **Устранение конфликта кликов в Leaflet:** Отключен внутренний обработчик Leaflet `_openPopup`, вызывавший мгновенное закрытие. Внедрен механизм переключения `marker.togglePopup()`.
   - **Переключение по клику:** Первый клик по объекту силы открывает компактную тактическую карточку; повторный клик по объекту (или по крестику) закрывает её.
   - **Следование за движущимся объектом:** Окно связано с экземпляром маркера (`Marker`) и обновляется через `setLatLng` и `setPopupContent`. При перемещении подразделения в реальном времени открытое окно плавно перемещается вместе с ним по карте.
   - **Отображаемые параметры:** Название подразделения, значок роли, оперативный сектор, координаты с точностью до 5 знаков, курс/направление (Heading/Bearing), статус связи (онлайн / сигнал устарел >60 сек) и список бойцов подразделения (имена и военные специальности).

3. **Контролируемое создание тревог ("Open Alert" & "Select from Map"):**
   - Создание тревог случайным кликом по карте полностью заблокировано.
   - Пользователь нажимает кнопку **"Open Alert"** в интерфейсе и выбирает **"Select from Map"**.
   - Карта переходит в режим выбора координат (курсор-прицел и верхний баннер), где одиночный клик сразу регистрирует координаты в форму и возвращает пользователя в окно тревоги без необходимости нажимать дополнительные кнопки.

4. **Модуль регистрации сил и штабов (`UserRegistrationModal`):**
   - Полная поддержка добавления всех типов сил: `AreaCommandCenter`, `Squad`, `SapperSquad`, `Radar`, `MainCommandCenter`.
   - Автоматическая генерация позывного/логина (Username slug) на основе названия подразделения (например, ввод "Northern Command Center" автоматически устанавливает `command_north`).
   - Быстрые шаблоны для Северного, Центрального и Южного командований с предустановленными координатами и секторами.
   - Конструктор личного состава для боевых групп с валидацией 7-значного личного номера, имени и специальности (стрелок, сапер, медик, разведчик).

---

### Б. Серверная архитектура и пространственная логика (Backend)
1. **Централизация пространственных расчетов (Формула гаверсинусов):**
   - Все вычисления расстояний и периметров опасных зон сведены в единый производительный модуль без внешних тяжелых зависимостей.
2. **Система контроля проникновения в зону опасности (Danger Zone Intrusion):**
   - Расчет сближения сил с опасными зонами (радиус по умолчанию 150 м) вокруг взрывоопасных предметов и БПЛА.
   - Мгновенная рассылка оповещений через WebSockets строго затронутым подразделениям с дедупликацией в оперативной памяти и автоочисткой при выходе из зоны.
3. **Высокоскоростное вещание событий:**
   - Рассылка Socket.IO отвязана от задержек записи в PostgreSQL, что гарантирует моментальный отклик интерфейса.
4. **Оптимизация базы данных и зависимостей:**
   - Удалены неиспользуемые библиотеки (`passlib`, `shapely`, `python-multipart`).
   - Сконфигурирован пул подключений SQLAlchemy для облачной СУБД Supabase.
   - Введено разграничение прав: уничтожение БПЛА разрешено исключительно операторам РЛС (`Radar`).

---

### В. Симулятор движения и 3D-трекинг РЛС (Simulator)
1. **Непрерывные патрули с интерполяцией:**
   - Густая интерполяция путевых точек для плавного реалистичного движения патрулей.
   - Бесконечный цикл движения нескольких боевых групп одновременно.
2. **Трехмерная симуляция воздушных целей для станций РЛС:**
   - Поддержка высоты, скорости и курса в реальном времени для воздушных угроз и дронов.
3. **Кроссплатформенная автоматизация:**
   - Исправлена кодировка консоли Windows в средах PowerShell/CMD.
   - Созданы скрипты запуска одной командой: `start.ps1`, `start.bat` и `start.sh`.

---

## 3. Реестр основных коммитов за сегодня

| Хэш коммита | Сообщение коммита | Направление |
|---|---|---|
| `aae63f0` | `fix(frontend): exclude static HQs from zoom, ensure forces are clickable with moving details window` | Карта и тактический зум |
| `b298413` | `feat(frontend): force registration, moving props popups, selective alert picking, and dynamic sector auto-fit` | Модальные окна и карточки сил |
| `4cf1e89` | `refactor(backend): centralize spatial calculations, fix refresh claims and sector bounds` | Пространственная геометрия и Auth |
| `3814ad2` | `refactor(backend): remove unused imports, deduplicate alert logic, and optimize codebase` | Очистка и оптимизация кода |
| `5996260` | `fix(store): resolve conflict markers in useMapStore after pulling remote changes` | Управление состоянием (Store) |
| `f019658` | `fix(map): enable map click alert opening, regional headquarters markers, and manager zone controls` | Слои карты и управление |
| `7e2b93c` | `feat: restrict drone destruction to Radar only and strictly limit alerts to danger circle` | Разграничение прав уничтожения |
| `c467b5b` | `fix(alerts): trigger danger alert once per entry only to the affected squad and clear on exit` | Дедупликация тревог |
| `b5bc2bd` | `fix(sockets): decouple real-time danger alerts from DB latency and include squad names` | Ускоренная рассылка сокетов |
| `aeb67a3` | `feat(alerts): add drone danger zone intrusion detection and real-time alerts` | Мониторинг опасных зон |
| `53113b0` | `feat(simulator): add radar 3D drone tracks, in-memory spatial broadcasting, and db pool tuning` | Симулятор и 3D-треки |
| `8e12835` | `feat(simulator): add radar station 3D drone simulation with real-time flight telemetry` | Полетная телеметрия БПЛА |
| `c57c1c3` | `feat(simulator): add dense waypoint interpolation for smooth realistic patrol loops` | Плавность траекторий |
| `e0dd49f` | `feat(simulator): add infinite continuous patrol loop and concurrent multi-unit movement` | Параллельный патруль |
| `0e51b73` | `fix(map): replace CartoDB with free Esri Dark Gray and Satellite layers without API key requirement` | Бесплатные базовые карты |
| `d7930c2` | `fix(auth): align demo credentials with database seed and seed Supabase DB` | Аутентификация и сид базы |
| `e0eef33` | `feat(scripts): add Windows PowerShell and batch startup scripts` | Скрипты автоматизации запуска |

---

## 4. Ключевые файлы проекта
- [TacticalMap.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Map/TacticalMap.tsx) — Ядро карты, логика динамического зума без штабов, интерактивные всплывающие окна.
- [UserRegistrationModal.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Forms/UserRegistrationModal.tsx) — Форма создания подразделений и региональных штабов с автогенерацией позывных.
- [ThreatModal.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Forms/ThreatModal.tsx) — Окно регистрации тревог с выбором координат на карте.
- [useMapStore.ts](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/store/useMapStore.ts) — Глобальное состояние карты Zustand (силы, тревоги, модальные окна, выбор точки).
- [index.css](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/index.css) — Стили тактического интерфейса, оформление всплывающих окон `.tactical-force-popup`.
- [Header.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Dashboard/Header.tsx) и [UnitListDrawer.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Dashboard/UnitListDrawer.tsx) — Кнопки управления и вызов регистрации сил.
- [simulator/main.py](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/backend/simulator/main.py) — Движок симуляции движения групп и 3D-треков БПЛА.
- [backend/app/api/v1/endpoints/threats.py](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/backend/app/api/v1/endpoints/threats.py) — Управление тревогами, радиусы поражения и проверка прав доступа.
