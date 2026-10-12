# Ghidul administratorului

Ghid pentru administratorul unui oraș din **Historic City Map** (primul oraș: **București dispărut**). Acesta este scheletul ghidului: secțiunile se completează odată cu funcțiile, în etapele M2–M5. Versiunea în engleză: [ADMIN_GUIDE.en.md](ADMIN_GUIDE.en.md); cele două versiuni se actualizează împreună.

> Stare (M2b): conectarea, pagina administratorilor și tot Asistentul de configurare de mai jos funcționează cap-coadă cu emulatoarele Firebase și serviciile Google, Mapbox și USGS simulate din teste; primul proiect real se configurează cu Claude, cu acordul tău la fiecare pas. Ecranele pentru fotografii, straturi și setări urmează în M2c–M4.

## Ce faci tu și ce face aplicația

Aplicația face aproape totul automat. Doar tu poți:

- crea conturi și introduce date de facturare sau de card (Google Cloud, Mapbox, USGS);
- accepta termeni și condiții și aproba consimțămintele de autentificare Google;
- lipi o singură dată cele două chei secrete: tokenul secret Mapbox și tokenul de aplicație USGS;
- plăti comenzile de scanare USGS, dacă vrei cadre încă nescanate.

Aplicația deschide pagina exactă (link direct), îți arată butonul, verifică rezultatul și trece singură la pasul următor. Cheile secrete ajung direct în Secret Manager; nu sunt păstrate în browser și nu apar niciodată în ecran după salvare.

## Prima conectare

- **O hartă nouă (încă fără server)**: înainte de legarea facturării harta nu are server, așa că primii pași vorbesc direct cu Google, din browserul tău („mod de pornire”). Conectează-te cu Google: Google îți cere să permiți accesul doar pentru citire la proiectele tale Cloud, iar aplicația verifică la Google că acest cont deține proiectul. Urmează facturarea, pregătirea proiectului și instalarea serverului (mai jos); imediat ce serverul răspunde, devii automat proprietarul hărții, fără alt clic.
- **O hartă care are deja server, dar nu are proprietar**, de exemplu când revii mai târziu: aplicația îți oferă **Confirmă cu Google**: Google îți cere același acces pentru citire, iar aplicația verifică că acest cont deține proiectul. Devii proprietarul hărții; nicio adresă de e-mail nu este configurată nicăieri.
- **Ferestrele de permisiune Google**: fiecare pas cere doar accesul de care are nevoie, în momentul în care rulează (citire la conectare, facturare pentru buget, Google Cloud pentru pregătirea proiectului, Google Analytics pentru o setare); activitatea zilnică nu cere niciunul. Aplicația spune de ce înainte de fiecare. Google poate spune că nu a verificat aplicația: e normal, aplicația este a proiectului tău; deschide opțiunile avansate și continuă. Accesul rămâne doar în fila browserului, cel mult o oră, și nu este salvat nicăieri; când expiră, pasul îți cere să continui.
- Oricine altcineva are nevoie de o invitație: un administrator introduce adresa persoanei, aplicația păstrează doar o amprentă a ei (nu adresa) și îți dă linkul de trimis. Persoana invitată se conectează cu Google la acel link și alege **Alătură-te**. O invitație expiră după 14 zile.
- Un cont Google fără invitație află acest lucru și este deconectat.

## Asistentul de configurare

Primul ecran până când toate cardurile obligatorii sunt verzi; **Verifică din nou** re-verifică oricând toată pagina sau un singur card. Pagina arată un cerc de progres („6 din 9 pași gata”) și câte un card pentru fiecare pas, notat de la a la h. Fiecare card are un indicator de stare cu pictogramă (**De făcut**, **În așteptare**, **Gata**, **Necesită atenție**, **Indisponibil acum**), de ce e nevoie de pas și cât costă, linkurile directe spre paginile furnizorului (fiecare se deschide într-o filă nouă), nota despre permisiunea Google înaintea oricărei ferestre Google, butonul pasului și **Verifică din nou**. Pe telefon cardurile stau într-o singură coloană, iar cardul deschis se extinde pe loc; de la 840 px lățime lista stă în stânga și pasul deschis alături. Când un pas devine verde, următorul se deschide singur (cardul de statistici rămâne deschis pentru setarea fluxului).

Tot asistentul cere cam zece clicuri sau câmpuri și patru permisiuni Google; ce faci pe paginile Google, Mapbox și USGS se adaugă și rămâne doar al tău. Capturile de ecran ale fiecărui pas, la lățimi de telefon, tabletă, laptop și ecran mare, în modurile luminos și întunecat, vin din testele end-to-end ([TESTING.md](TESTING.md) → *Review screenshots*).

**Modul de pornire.** Până la instalarea serverului hărții, un banner spune „Mod de pornire: harta nu are încă server, așa că pașii vorbesc direct cu Google.”, iar navigarea oferă doar Configurare. Ce găsesc pașii se păstrează în această filă a browserului (niciodată un token, o adresă sau date de card) și rezistă la reîncărcare; serverul îl înregistrează după instalare.

### a. Conectare și proprietate

- **Conectează-te cu Google** deschide fereastra Google cu acces doar pentru citire la Google Cloud; apoi Google confirmă că acest cont deține proiectul. Gata.
- Dacă serviciul Resource Manager este oprit într-un proiect nou-nouț, panoul de conectare se oferă să-l activeze (un clic, permisiunea Google Cloud).

### b. Facturare Google Cloud și buget

- **Leagă facturarea și creează bugetul de 5 USD**: un clic și o permisiune Google (facturare; Google Cloud dacă serviciile de facturare trebuie întâi pornite, iar atunci pasul c nu mai cere nimic). Aplicația leagă contul tău de facturare de proiect (planul Blaze) și creează bugetul lunar în moneda contului (5 USD, 5 EUR, 4 GBP, 25 RON), cu alerte la 50 %, 90 % și 100 % din cheltuieli. Cardul arată costul înainte de clic: cam 0,5–2 USD pe lună.
- **Încă fără cont de facturare**: cardul spune asta și are linkul **Conturile de facturare Google Cloud**, unde creezi contul și introduci cardul. Apoi arată „Așteptăm contul nou de facturare…” și verifică la fiecare 10 secunde (30 de minute, cât timp fila e vizibilă); contul nou se leagă singur.
- **Mai multe conturi**: alege unul (primul e deja ales) și **Leagă acest cont**.

### c. Pregătirea proiectului Google Cloud

- **Pregătește proiectul**: un clic (și permisiunea Google Cloud, dacă nu a cerut-o deja facturarea). Aplicația pregătește, în ordine, cele 15 elemente din card, fiecare cu starea lui: serviciile Google, conturile de serviciu, permisiunile, spațiile de stocare cu accesul browserului și curățarea lor, locurile pentru cheile secrete, coada de publicare, instalarea din GitHub fără chei, App Check, alertele bugetului, politicile organizației, e-mailul la erori noi și restricția cheii de browser. Rulat din nou, nu schimbă nimic din ce există deja.
- Un element care nu reușește spune de ce, iar elementele care depind de el așteaptă („Așteaptă: …”); celelalte merg mai departe. **Reia ce nu a reușit** le repetă doar pe acelea (câte un clic).
- „Verificarea periodică” așteaptă cu „Se creează la prima instalare a serverului.”; asta nu ține pasul pe loc.

### d. Instalarea serverului hărții

- Serverul (funcțiile Firebase) se instalează din GitHub Actions la următorul push pe `master` sau de către Claude, după acordul tău. Cardul arată variabilele depozitului GitHub pe care le citește instalarea, fiecare cu buton de copiere, apoi „Verificăm la fiecare 30 de secunde…” și „N din 33 funcții instalate”, și devine verde singur când toate funcțiile sunt instalate și răspund.
- O funcție care nu s-a instalat este numită; „Funcțiile sunt instalate, dar nu răspund” arată spre o politică a organizației care blochează accesul public.

### d2. Preluarea hărții

- Imediat ce serverul răspunde, aplicația te face proprietarul hărții cu permisiunea Google pe care o mai are (fără clic), creează orașul din datele site-ului vechi, înregistrează ce a găsit modul de pornire și iese din el: bannerul dispare, iar navigarea arată Configurare, Administratori și Erori. Se deschide cardul Mapbox.
- Dacă permisiunea Google a expirat (peste o oră sau după reîncărcarea paginii), panoul de preluare cere un clic: **Confirmă cu Google**.

### e. Mapbox

- Creezi contul și ieși din planul demo pe paginile Mapbox (card și adresă de facturare; linkul cardului spune să alegi *Rotate token*), bifezi alertele de utilizare, apoi creezi tokenul secret `historic-map-server` cu permisiunile din card (**Copiază permisiunile**).
- Lipește tokenul în **Tokenul secret (sk.…)**: cardul spune „Pare un token secret.” înainte de a trimite ceva (un token public `pk.` este explicat în loc). **Salvează**: tokenul ajunge o singură dată în Secret Manager, iar aplicația creează tokenurile publice ale site-ului și ale administrării, restricționate la adresele lor.
- Un cont demo nu poate crea tokenuri: cardul spune „Mapbox nu a creat tokenul public. Verifică datele de facturare ale contului Mapbox.”, cu linkul spre metoda de plată; adaug-o pe pagina Mapbox și lipește tokenul din nou.

### f. USGS

- Te înregistrezi la ERS și ceri accesul M2M cu răspunsurile și textul cererii deja scrise (**Copiază textul cererii**); aprobarea durează 24–48 de ore lucrătoare.
- Scrie **Numele de utilizator ERS** (și, opțional, data expirării tokenului), apoi **Deschide pagina tokenului USGS**: caseta de lipire se deschide prima și pornește o numărătoare de 60 de secunde („Lipește tokenul în 60 s”), pentru că USGS arată un token nou doar cam un minut. Lipește-l: este verificat și salvat imediat, fără clic pe Salvează. Dacă timpul expiră, cardul spune asta și caseta rămâne deschisă: creează un token nou.
- Până la aprobare cardul este **În așteptare**, cu „USGS nu a aprobat încă accesul M2M pentru acest cont. Verificăm din nou la fiecare 6 ore.” și ora următoarei verificări. Serverul observă singur aprobarea; cardul e verde data viitoare când deschizi administrarea.

### g. Statistici și rapoarte de erori (opțional)

- Urmezi linkul spre consola Firebase și activezi Google Analytics pentru proiect (accepți acolo termenii Google). Cardul verifică apoi la fiecare 15 secunde, timp de 15 minute, și arată ID-ul de măsurare.
- **Nu mai număra schimbările de adresă ca vizualizări**: un clic și permisiunea Google Analytics; harta își rescrie adresa la fiecare mișcare, așa că vizualizările din istoricul browserului trebuie să rămână oprite. Cardul spune apoi „Schimbările de adresă nu mai sunt numărate ca vizualizări.”
- **Trimite-mi un e-mail la erori noi** este pornit implicit; comutarea cere permisiunea Google Cloud.
- Panoul **Rapoarte de erori** (și pagina **Erori**) listează grupurile de erori din ultimele șapte zile.
- Vizitatorii sunt măsurați doar după acordul lor; Google Analytics nu primește niciodată partea de după `#` a adresei, unde stau vederea și poziția vizitatorului.

### h. Fotografiile vechi ale Bucureștiului (opțional)

- **Importă cele 45 fotografii**: un clic. Fotografiile trec prin procesarea obișnuită câte trei odată („N din 45 fotografii importate”), sunt publicate după procesare și rămân în coada de verificare a drepturilor; cardul se încheie cu „Toate cele 45 fotografii sunt pe hartă.”, iar datele publice ale orașului le listează. Un import repetat sau după o filă închisă nu adaugă nimic de două ori și termină doar ce lipsește.
- O fotografie care nu a putut fi procesată apare în listă cu motivul ei; celelalte se importă.

### Când un pas spune altceva

| Mesaj | Cauză | Ce faci |
| --- | --- | --- |
| „Doar proprietarul proiectului Google Cloud … poate configura harta.” | contul nu deține proiectul, iar harta nu are încă server | conectează-te cu contul Google al proprietarului |
| „Serverul hărții nu răspunde acum. Încearcă din nou peste un minut.” | harta a fost configurată, dar serverul ei nu răspunde | **Încearcă din nou**; dacă durează, verifică instalarea (pasul d) |
| „Pasul are nevoie de permisiunea „…”, nebifată la Google. Nu s-a schimbat nimic.” | o permisiune a fost debifată în fereastra Google | apasă din nou butonul pasului și las-o bifată |
| „Browserul a blocat fereastra Google. Permite ferestrele pop-up pentru acest site.” | ferestrele pop-up sunt blocate | permite ferestrele pop-up pentru adresa administrării |
| „Ai ales alt cont Google decât cel conectat. Alege același cont.” | în fereastra Google a fost ales alt cont | alege contul conectat |
| „Permisiunea Google pentru acest pas a expirat după o oră. Continuă ca să o reînnoiești.” | permisiunea se păstrează cel mult o oră | **Continuă** (un clic, o permisiune); pasul reia de unde a rămas |
| „Contul de facturare are deja numărul maxim de proiecte. …” | limita Google de proiecte pe cont de facturare | alege alt cont sau cere mai multe de la Google |
| „Niciun cont nou de facturare în 30 de minute. …” | contul nu a fost încă creat | creează-l, apoi **Verifică din nou** |
| „Politica … a organizației blochează acest element.” | o regulă a organizației tale Google | ghidul acelei reguli; schimbarea ei e decizia ta |
| „Contul serverului nu are rolul … în proiect.” | lipsește un rol contului care a făcut apelul | acordă rolul numit, apoi **Reia ce nu a reușit** sau **Verifică din nou** |
| „Funcția … nu s-a instalat. Reia instalarea.” | o funcție nu s-a instalat | reia instalarea |
| „Serverul nu s-a instalat nici după două ore. …” | instalarea nu a rulat | rulează-o (GitHub Actions sau Claude), apoi **Verifică din nou** |
| „Mapbox a refuzat tokenul: nu este valid sau a fost revocat.” | token greșit, șters sau revocat | creează tokenul din nou și lipește-l |
| „Tokenului îi lipsesc permisiunile: …” | permisiuni nebifate | creează tokenul din nou cu toate permisiunile din card |
| „USGS a refuzat utilizatorul sau tokenul. …” | utilizator greșit sau token expirat | creează un token nou și lipește-l în 60 de secunde |
| „USGS este în mentenanță. Reîncercăm automat.” | mentenanță USGS | nimic: tokenul este păstrat |
| „Google Analytics nu este activat pentru proiect. …” | Analytics este oprit | activează-l în consola Firebase (linkul cardului) |
| „Fotografii neprocesate: N. Motivul apare lângă fiecare.” | o fotografie din pachet nu a putut fi procesată | **Verifică din nou** sau editează fotografia când apar ecranele foto (M2c) |

## Activitatea zilnică

### Fotografii

- Tragi fișierele în pagină; locul, anul și direcția sunt completate din EXIF și din numele fișierului.
- Fixezi punctul pe hartă și dai clic pe ce privea aparatul (de aici direcția); unghiul implicit este 60°.
- Autorul, sursa și licența rămân aceleași pentru tot lotul; fotografia se publică la salvare.
- Sunt acceptate JPEG, PNG, WebP și TIFF, până la 60 MB și 200 de megapixeli; SVG niciodată. Fotografiile HEIC de pe iPhone nu pot fi convertite încă pe server: pe iPhone alege Setări → Cameră → Formate → Cel mai compatibil, sau exportă fotografia ca JPEG. O fotografie identică cu una deja încărcată este marcată ca duplicat.
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
- Administratori: invitație după adresa de e-mail (se păstrează doar amprenta ei; linkul îl trimiți tu), eliminarea unui administrator sau a unei invitații în așteptare; proprietarul nu poate fi eliminat și nimeni nu se poate elimina singur, așa că harta are mereu un administrator.
- De completat (M2–M3).

## Costuri

- Google Cloud: aproximativ 0,5–2 $ pe lună; bugetul de 5 $ oprește automat procesarea imaginilor (niciodată site-ul).
- Mapbox: gratuit până la 50.000 de încărcări de hartă pe lună; publicarea straturilor folosește doar bugetul gratuit, altfel îți oferă încărcarea gratuită prin Studio, amânarea sau plata.
- USGS: cadrele scanate sunt gratuite; o scanare nouă costă 30 $ pe cadru plus 5 $ pe comandă.

## Probleme frecvente

De completat odată cu fiecare ecran: mesajul afișat, cauza și ce trebuie făcut.

### Harta publică (din M1)

Când pagina orașului nu poate afișa harta, arată un card cu unul dintre mesajele de mai jos, în limba vizitatorului. Cele pe care le poate rezolva administratorul orașului:

| Mesaj | Cauză | Ce faci |
| --- | --- | --- |
| „Harta nu a fost găsită. Încearcă din nou mai târziu.” | pagina nu a găsit `manifest.json` la adresa din `config.js` | publici orașul (M2) sau corectezi `manifestUrl` în `config.js` |
| „Datele hărții sunt nevalide (probleme găsite: N).”, urmat de `câmp: regulă` | manifestul încalcă o regulă din City Manifest v1; cardul numește primul câmp și regula | corectezi acel câmp (în aplicația de administrare din M2; pe un site făcut din kitul de pornire, în `data/manifest.json`) |
| „Lipsește config.js” / „config.js este nevalid: …” | pagina nu are `window.HistoricCityMapConfig` sau un câmp din el este necunoscut ori greșit | compari `config.js` cu cel din kitul de pornire (`starter-kit/README.md`) |
| „cityId din config.js (…) nu corespunde hărții (…).” | `config.js` arată spre manifestul altui oraș | faci `cityId` și orașul din manifest să fie același |
| „Această hartă are nevoie de o versiune mai nouă a paginii (X). Reîncarcă pagina mai târziu.” | manifestul cere un motor mai nou decât cel încărcat de pagină | încarci versiunea de motor din mesaj |
| „Browserul tău nu poate afișa harta interactivă. Lista fotografiilor rămâne disponibilă.” | browserul vizitatorului nu are WebGL | nimic: vizitatorul primește în continuare lista fotografiilor |
