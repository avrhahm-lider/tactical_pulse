# סיכום פיתוח יומי — Tactical Pulse (טקטיקל פולס)
**תאריך:** 11 באוקטובר 2026  
**ענף פעיל:** `dev`  
**מאגר:** `tactical_pulse`

---

## 1. תקציר מנהלים
היום הושלמו פיתוחים מקיפים במערכת השו״ב (C2) של Tactical Pulse, תוך התמקדות בשדרוג חוויית המשתמש במפה המבצעית (Frontend), חידוד לוגיקת החישוב המרחבי וההתרעות (Backend), שילוב סימולטור תנועה מתקדם לכוחות ולרחפנים, והטמעת תהליך רישום כוחות חדש.

במהלך הפיתוח נשמרה הקפדה יתרה על הפרדה מוחלטת: כל שינויי הממשק בוצעו בצד הלקוח (Frontend) ללא שבירת חוזה ה-API או שינוי בלתי מורשה של ה-Backend.

---

## 2. פירוט השינויים והעדכונים לפי תחומים

### א. המפה הטקטית וניהול תצוגת הזום (Frontend Map & Viewport)
1. **התאמת זום דינמית לאובייקטים רלוונטיים בלבד (Dynamic Sector Auto-Fit):**
   - **החרגת מפקדות סטטיות:** מפקדות מרחביות (`AreaCommandCenter`) והמפקדה הראשית (`MainCommandCenter`) הוגדרו כאובייקטים סטטיים והוחרגו מחישוב תיבת התחום (Bounding Box). המפה מתמקדת באופן בלעדי בכוחות דינמיים (`Squad`, `SapperSquad`, `Radar`) ובהתרעות/אירועים פעילים (`threats`).
   - **דיוק טריטוריאלי לפי גזרה:** 
     - עבור פיקוד מרכז (או כוח בתוך הגזרה), אם קיימים כוחות בשני קצוות נתניה (צפון ודרום), הזום יקיף בדיוק את המרחב שבין קצוות נתניה, תוך התעלמות משטחים ריקים.
     - ברגע שמופיע איום או כוח סמוך לגבול ירדן, תצוגת פיקוד מרכז מתרחבת אוטומטית להכיל הן את נתניה והן את גבול ירדן.
     - עבור הפיקוד הראשי (`MainCommandCenter`), אם מוגדרים אירועים בנתניה ובאילת, המבט יתפרס אוטומטית מאילת ועד נתניה.
   - **ביטול קיבוע ברירות מחדל:** הוסרו תחימות ברירת מחדל סטטיות בעת טעינת המפה, כך שמיד עם קבלת הנתונים המצלמה מתמקמת במדויק על האירועים והכוחות הפעילים.

2. **חלון פרטי כוח צף ונע ("Prop" / Details Popup):**
   - **פיתרון קונפליקט הלחיצה ב-Leaflet:** הוסר מאזין ברירת המחדל הפנימי (`_openPopup`) של Leaflet שמנע פתיחה חוזרת, והוטמע מנגנון `togglePopup` נקי.
   - **פתיחה וסגירה בלחיצה:** לחיצה ראשונה על אובייקט הכוח פותחת חלונית מידע טקטית קומפקטית; לחיצה חוזרת על האובייקט (או על כפתור הסגירה) סוגרת אותה.
   - **תנועה מתמדת יחד עם הכוח:** החלונית מקושרת למופע הסמן (`Marker`) ומתעדכנת באמצעות `setLatLng` ו-`setPopupContent`, כך שבעת תנועת הכוח בזמן אמת החלונית ממשיכה לנוע בצורה חלקה יחד איתו על גבי המפה.
   - **מידע המוצג בחלונית:** שם הכוח, תג תפקיד, גזרה מבצעית, קואורדינטות בדיוק של 5 ספרות, כיוון תנועה (Heading/Bearing), סטטוס קליטה (מקוון / אות ישן >60 שניות), ומצבת הלוחמים ביחידה (שמות ותפקידים).

3. **מנגנון פתיחת התרעות מבוקר ("Open Alert" & "Select from Map"):**
   - בוטלה האפשרות להוסיף התרעות בלחיצה מקרית על המפה.
   - על המשתמש ללחוץ תחילה על "Open Alert" (פתיחת התרעה) ולבחור ב-"Select from Map".
   - הממשק עובר למצב דקירת נ״צ (סמן צלב ובאנר עליון), שבו לחיצה על המפה רושמת את הקואורדינטות מידית ומחזירה את המשתמש לטופס ההתרעה ללא צורך בלחיצה על כפתור נוסף.

4. **מודאל רישום כוחות ומפקדות (`UserRegistrationModal`):**
   - תמיכה מלאה בהוספת כל סוגי הכוחות: `AreaCommandCenter`, `Squad`, `SapperSquad`, `Radar`, ו-`MainCommandCenter`.
   - התאמה אוטומטית של שם המשתמש (Call-sign / Username slug) ברגע שמוזן שם למפקדה או ליחידה (לדוגמה: "Northern Command Center" מעדכן אוטומטית ל-`command_north`).
   - בורר תבניות מהיר למפקדות פיקודיות (פיקוד צפון, פיקוד מרכז, פיקוד דרום) המגדיר מראש נ״צ מדויק, גזרה ותיאור.
   - מנגנון בניית מצבת לוחמים מובנה עבור כוחות שדה לוחמים (שם, ת״ז 7 ספרות, ותפקיד).

---

### ב. מנוע השרת והלוגיקה המרחבית (Backend & Spatial Architecture)
1. **מרכזיות חישובי מרחב (Haversine Spatial Calculations):**
   - ריכוז נוסחאות מרחק והיקפי סכנה לקובץ מרכזי ללא תלות בספריות כבדות חיצוניות.
2. **מערך התרעות חדירה למעגל סכנה (Danger Zone Intrusion):**
   - זיהוי כניסת כוחות למעגל סכנה (רדיוס ברירת מחדל 150 מטר) סביב איומים ורחפנים.
   - שליחת התרעה בזמן אמת דרך WebSockets ישירות לכוח הרלוונטי בלבד, עם מניעת כפילויות בזיכרון וניקוי אוטומטי ביציאה ממעגל הסכנה.
3. **הפרדת תהליכי שידור בזמן אמת מהשהיות מסד הנתונים:**
   - הפצת אירועי Socket.IO ישירות מתוך זיכרון השרת במקביל לשמירה האסינכרונית במסד הנתונים, להבטחת זמן תגובה מיידי ב-Frontend.
4. **ייעול תלויות וחיבורי DB:**
   - הסרת תלויות עודפות (`shapely`, `passlib`, `python-multipart`).
   - התאמת מאגר החיבורים (Connection Pooling) של SQLAlchemy לעבודה מול Supabase בענן.
   - הגבלת פעולת הפלת רחפנים לכוחות מכ״ם (`Radar`) בלבד לפי הרשאות תפקיד.

---

### ג. סימולטור תנועה ומסלולי מכ״ם (Movement Simulator & Radar)
1. **מסלולי פטרול רציפים ואינטרפולציית נקודות ציון:**
   - הוספת אינטרפולציה צפופה של נקודות ציון לתנועה חלקה וריאליסטית של צוותי שדה.
   - לולאת פטרול אינסופית המאפשרת תנועה רציפה של מספר יחידות במקביל.
2. **סימולציית מעקב תלת-ממדי לרחפנים בתחנת מכ״ם:**
   - תמיכה בנתוני גובה, מהירות וכיוון בזמן אמת לרחפנים ומטרות אוויריות.
3. **תאימות סביבת Windows והפעלת סקריפטים:**
   - תיקון קידודי מסוף (Console Encoding) בסביבת PowerShell/CMD.
   - הוספת סקריפטי הפעלה מהירים בפקודה אחת: `start.ps1`, `start.bat`, ו-`start.sh`.

---

## 3. יומן קומיטים עיקריים להיום (Commit Log)

| מזהה קומיט | תיאור הקומיט | תחום |
|---|---|---|
| `aae63f0` | `fix(frontend): exclude static HQs from zoom, ensure forces are clickable with moving details window` | מפה וזום טקטי |
| `b298413` | `feat(frontend): force registration, moving props popups, selective alert picking, and dynamic sector auto-fit` | מודאל רישום וחלוניות כוח |
| `4cf1e89` | `refactor(backend): centralize spatial calculations, fix refresh claims and sector bounds` | בקאנד וחישובים מרחביים |
| `3814ad2` | `refactor(backend): remove unused imports, deduplicate alert logic, and optimize codebase` | אופטימיזציה וניקוי קוד |
| `5996260` | `fix(store): resolve conflict markers in useMapStore after pulling remote changes` | ניהול מצב לקוח (Store) |
| `f019658` | `fix(map): enable map click alert opening, regional headquarters markers, and manager zone controls` | בקרי מפה ושכבות |
| `7e2b93c` | `feat: restrict drone destruction to Radar only and strictly limit alerts to danger circle` | הרשאות השמדת איומים |
| `c467b5b` | `fix(alerts): trigger danger alert once per entry only to the affected squad and clear on exit` | מניעת כפילויות התרעות |
| `b5bc2bd` | `fix(sockets): decouple real-time danger alerts from DB latency and include squad names` | שידור WebSockets מואץ |
| `aeb67a3` | `feat(alerts): add drone danger zone intrusion detection and real-time alerts` | מנוע חדירה למעגל סכנה |
| `53113b0` | `feat(simulator): add radar 3D drone tracks, in-memory spatial broadcasting, and db pool tuning` | סימולטור ומסלולי מכ״ם |
| `8e12835` | `feat(simulator): add radar station 3D drone simulation with real-time flight telemetry` | טלמטריה אווירית 3D |
| `c57c1c3` | `feat(simulator): add dense waypoint interpolation for smooth realistic patrol loops` | אינטרפולציית תנועה |
| `e0dd49f` | `feat(simulator): add infinite continuous patrol loop and concurrent multi-unit movement` | פטרול מרובה יחידות |
| `0e51b73` | `fix(map): replace CartoDB with free Esri Dark Gray and Satellite layers without API key requirement` | שכבות מפה חינמיות |
| `d7930c2` | `fix(auth): align demo credentials with database seed and seed Supabase DB` | אימות וסיד מסד נתונים |
| `e0eef33` | `feat(scripts): add Windows PowerShell and batch startup scripts` | סקריפטי הפעלה |

---

## 4. קבצים מרכזיים בפרויקט שהושפעו היום
- [TacticalMap.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Map/TacticalMap.tsx) — ליבת המפה, חישוב הזום הממוקד, וניהול סמני הכוחות והחלוניות הצפות.
- [UserRegistrationModal.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Forms/UserRegistrationModal.tsx) — מודאל רישום כוחות ומפקדות אזוריות עם שיוך אוטומטי של שם משתמש.
- [ThreatModal.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Forms/ThreatModal.tsx) — טופס פתיחת התרעה ומצב דקירת נ״צ במפה.
- [useMapStore.ts](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/store/useMapStore.ts) — ניהול מצב גלובלי (Zustand) של כוחות, התרעות, מודאלים ומצב דקירה.
- [index.css](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/index.css) — עיצוב טקטי יוקרתי, חלוניות צפות `.tactical-force-popup`, ואפקטי HUD.
- [Header.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Dashboard/Header.tsx) ו-[UnitListDrawer.tsx](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/frontend/src/components/Dashboard/UnitListDrawer.tsx) — כפתורי הפעלה ישירים לפתיחת התרעה ורישום כוח.
- [simulator/main.py](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/backend/simulator/main.py) — מנוע תנועת כוחות ורחפני מכ״ם בזמן אמת.
- [backend/app/api/v1/endpoints/threats.py](file:///c:/Users/1234/VSCodeProject/kodcode_reapos/tactical_pulse/backend/app/api/v1/endpoints/threats.py) — לוגיקת טיפול באיומים והרשאות נטרול.
