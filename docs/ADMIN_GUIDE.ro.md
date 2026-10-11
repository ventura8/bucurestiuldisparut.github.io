# Ghidul administratorului

Ghid pentru administratorul unui oraș din **Historic City Map** (primul oraș: **București dispărut**). Acesta este scheletul ghidului: secțiunile se completează odată cu funcțiile, în etapele M2–M5. Versiunea în engleză: [ADMIN_GUIDE.en.md](ADMIN_GUIDE.en.md); cele două versiuni se actualizează împreună.

> Stare: aplicația de administrare apare în etapa M2. Până atunci, acest ghid descrie ce va face fiecare ecran.

## Ce faci tu și ce face aplicația

Aplicația face aproape totul automat. Doar tu poți:

- crea conturi și introduce date de facturare sau de card (Google Cloud, Mapbox, USGS);
- accepta termeni și condiții și aproba consimțămintele de autentificare Google;
- lipi o singură dată cele două chei secrete: tokenul secret Mapbox și tokenul de aplicație USGS;
- plăti comenzile de scanare USGS, dacă vrei cadre încă nescanate.

Aplicația deschide pagina exactă (link direct), îți arată butonul, verifică rezultatul și trece singură la pasul următor. Cheile secrete ajung direct în Secret Manager; nu sunt păstrate în browser și nu apar niciodată în ecran după salvare.

## Asistentul de configurare

Primul ecran până când toate cardurile sunt verzi; poate fi re-verificat oricând. Fiecare pas are: un indicator de stare, motivul și costul, un link direct, „Fă-o pentru mine” unde se poate, o casetă de lipire cu verificare pe loc și avans automat.

### Google Cloud: facturare (Blaze) și buget

- Autentificare Google cu permisiunile suplimentare pentru facturare.
- Dacă nu ai cont de facturare: link direct către pagina Google unde introduci cardul; aplicația detectează contul nou.
- Un clic leagă contul de proiect (planul Blaze) și creează bugetul de 5 $ cu alerte.
- De completat (M2): capturi de ecran, mesaje de eroare și ce înseamnă fiecare.

### Pregătirea infrastructurii

- Un clic pornește pregătirea idempotentă: API-uri, conturi de serviciu și permisiuni, bucket-uri, federarea identității pentru CI, secrete.
- „Doctor”: starea fiecărui element, re-verificabilă.
- De completat (M2).

### Mapbox

- Ieșirea din planul demo: adresa de facturare și cardul, pe pagina Mapbox.
- Alertele de utilizare din consola Mapbox.
- Tokenul secret: creat de tine în consolă, cu permisiunile afișate în aplicație; îl lipești o singură dată. Aplicația verifică permisiunile și creează automat tokenurile publice, restricționate la adresele site-ului și ale aplicației.
- De completat (M2).

### USGS

- Înregistrarea în ERS și cererea de acces M2M (textul justificării este gata scris); aprobarea durează 24–48 de ore lucrătoare.
- Tokenul de aplicație: caseta de lipire se deschide înainte să îl generezi, pentru că USGS îl afișează doar circa 60 de secunde.
- Aprobarea este detectată automat, iar cardul devine verde singur.
- De completat (M2).

### Analiză și raportarea erorilor

- Activarea Google Analytics pentru proiect (termenii îi accepți tu); identificatorul de măsurare este detectat automat.
- Panoul „Rapoarte de erori” cu cele mai recente grupuri de erori.
- Vizitatorii văd analiza doar după ce își dau acordul.
- De completat (M2).

## Activitatea zilnică

### Fotografii

- Tragi fișierele în pagină; locul, anul și direcția sunt completate din EXIF și din numele fișierului.
- Fixezi punctul pe hartă și dai clic pe ce privea aparatul (de aici direcția); unghiul implicit este 60°.
- Autorul, sursa și licența rămân aceleași pentru tot lotul; fotografia se publică la salvare.
- De completat (M2): editare, retragere, coada de verificare a drepturilor pentru fotografiile vechi.

### Straturi istorice din satelit

- „Caută imagini”: scene USGS ordonate după acoperire, cu previzualizări.
- „Importă (gratuit)” pentru cadrele deja scanate; „Cumpără scanarea” pregătește comanda EarthExplorer (plata o faci tu); „Încarcă GeoTIFF”; „Leagă un tileset sau XYZ”.
- Costul estimat (megaocteți și unități de procesare Mapbox) este afișat înainte de import.
- De completat (M3–M4).

### Georeferențiere

- Puncte de control pe scanare și pe harta de referință (OpenStreetMap și Sentinel-2), tabel de reziduuri, previzualizare suprapusă.
- Un strat se publică după aprobarea ta sau automat, când eroarea medie este sub prag.
- De completat (M3).

### Lucrări, setări și administratori

- Lucrări: progres în timp real, reîncercare, anulare.
- Setări: limitele orașului, textul „Despre” (RO și EN), mențiuni, culoarea de bază cu previzualizare.
- Administratori: invitație prin e-mail, revocare; proprietarul nu poate fi revocat, iar ultimul administrator este protejat.
- De completat (M2–M3).

## Costuri

- Google Cloud: aproximativ 0,5–2 $ pe lună; bugetul de 5 $ oprește automat procesarea imaginilor (niciodată site-ul).
- Mapbox: gratuit până la 50.000 de încărcări de hartă pe lună; publicarea straturilor folosește doar bugetul gratuit, altfel îți oferă încărcarea gratuită prin Studio, amânarea sau plata.
- USGS: cadrele scanate sunt gratuite; o scanare nouă costă 30 $ pe cadru plus 5 $ pe comandă.

## Probleme frecvente

De completat odată cu fiecare ecran: mesajul afișat, cauza și ce trebuie făcut.
