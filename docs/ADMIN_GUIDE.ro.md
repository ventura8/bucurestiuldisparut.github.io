# Ghidul administratorului

Ghid pentru administratorul unui oraș din **Historic City Map** (primul oraș: **București dispărut**). Acesta este scheletul ghidului: secțiunile se completează odată cu funcțiile, în etapele M2–M5. Versiunea în engleză: [ADMIN_GUIDE.en.md](ADMIN_GUIDE.en.md); cele două versiuni se actualizează împreună.

> Stare (M3): conectarea, Asistentul de configurare, editoarele de zi cu zi de mai jos (Acasă, fotografii, locuri, straturi, setări, istoric, procesări, administratori și erori) și imaginile istorice (căutarea la USGS, importul unui cadru gratuit, georeferențierea automată, Aprobă, paza unităților de calcul, încărcarea gratuită prin Studio, încărcarea unui GeoTIFF, georeferențiatorul, decuparea, înlocuirea) funcționează cap-coadă cu emulatoarele Firebase și serviciile Google, Mapbox și USGS simulate din teste, iar ce se publică ajunge în harta publică prin manifestul construit de server; procesarea imaginilor însăși a rulat cu aceleași servicii simulate, pe un cadru sintetic. Imaginile pe cloudul real așteaptă instalarea serverului (funcțiile, imaginea procesării și jobul ei Cloud Run), aprobarea descărcărilor M2M de către USGS și tokenul secret Mapbox (`docs/research/M3-status.md`). Primul proiect real se configurează cu Claude, cu acordul tău la fiecare pas.

## Ce faci tu și ce face aplicația

Aplicația face aproape totul automat. Doar tu poți:

- crea conturi și introduce date de facturare sau de card (Google Cloud, Mapbox, USGS);
- accepta termeni și condiții și aproba consimțămintele de autentificare Google;
- lipi o singură dată cele două chei secrete: tokenul secret Mapbox și tokenul de aplicație USGS;
- plăti comenzile de scanare USGS, dacă vrei cadre încă nescanate.

Aplicația deschide pagina exactă (link direct), îți arată butonul, verifică rezultatul și trece singură la pasul următor. Cheile secrete ajung direct în Secret Manager; nu sunt păstrate în browser și nu apar niciodată în ecran după salvare.

## Prima conectare

- **O hartă nouă (încă fără server)**: înainte de legarea facturării harta nu are server, așa că primii pași vorbesc direct cu Google, din browserul tău („mod de pornire”). Prima ei publicare (doar aplicația de administrare, înaintea serverului) spune asta, așa că pagina nici nu încearcă serverul: `HCM_ADMIN_START_UP=1 npx firebase deploy --only hosting`, făcută de Claude cu acordul tău. Conectează-te cu Google: Google îți cere să permiți accesul doar pentru citire la proiectele tale Cloud, iar aplicația verifică la Google că acest cont deține proiectul. Urmează facturarea, pregătirea proiectului și instalarea serverului (mai jos); imediat ce serverul răspunde, devii automat proprietarul hărții, fără alt clic.
- **O hartă care are deja server, dar nu are proprietar**, de exemplu când revii mai târziu: aplicația îți oferă **Confirmă cu Google**: Google îți cere același acces pentru citire, iar aplicația verifică că acest cont deține proiectul. Devii proprietarul hărții; nicio adresă de e-mail nu este configurată nicăieri.
- **Ferestrele de permisiune Google**: fiecare pas cere doar accesul de care are nevoie, în momentul în care rulează (citire la conectare, facturare pentru buget, Google Cloud pentru pregătirea proiectului, Google Analytics pentru o setare); activitatea zilnică nu cere niciunul. Aplicația spune de ce înainte de fiecare. Google poate spune că nu a verificat aplicația: e normal, aplicația este a proiectului tău; deschide opțiunile avansate și continuă. Accesul rămâne doar în fila browserului, cel mult o oră, și nu este salvat nicăieri; când expiră, pasul îți cere să continui.
- Oricine altcineva are nevoie de o invitație: un administrator introduce adresa persoanei, aplicația păstrează doar o amprentă a ei (nu adresa) și îți dă linkul de trimis. Persoana invitată se conectează cu Google la acel link și alege **Alătură-te**. O invitație expiră după 14 zile.
- Un cont Google fără invitație află acest lucru și este deconectat.

## Asistentul de configurare

Primul ecran până când toate cardurile obligatorii sunt verzi; **Verifică din nou** re-verifică oricând toată pagina sau un singur card; pentru toată pagina arată și **Verificările serverului**, fiecare cu starea ei, iar una care nu trece spune de ce și duce la pasul care o rezolvă. Pagina arată un cerc de progres („6 din 9 pași gata”) și câte un card pentru fiecare pas, notat de la a la h. Fiecare card are un indicator de stare cu pictogramă (**De făcut**, **În așteptare**, **Gata**, **Necesită atenție**, **Indisponibil acum**), de ce e nevoie de pas și cât costă, linkurile directe spre paginile furnizorului (fiecare se deschide într-o filă nouă), nota despre permisiunea Google înaintea oricărei ferestre Google, butonul pasului și **Verifică din nou**. Pe telefon cardurile stau într-o singură coloană, iar cardul deschis se extinde pe loc; de la 840 px lățime lista stă în stânga și pasul deschis alături. Când un pas devine verde, următorul se deschide singur (cardul de statistici rămâne deschis pentru setarea fluxului).

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

- Serverul (funcțiile Firebase) se instalează din GitHub Actions la următorul push pe `master` sau de către Claude, după acordul tău. Cardul arată variabilele depozitului GitHub pe care le citește instalarea, fiecare cu buton de copiere, apoi „Verificăm la fiecare 30 de secunde…” și „N din 35 funcții instalate”, și devine verde singur când toate funcțiile sunt instalate și răspund.
- O funcție care nu s-a instalat este numită; „Funcțiile sunt instalate, dar nu răspund” arată spre o politică a organizației care blochează accesul public.

### d2. Preluarea hărții

- Imediat ce serverul răspunde, aplicația te face proprietarul hărții cu permisiunea Google pe care o mai are (fără clic), creează orașul din datele site-ului vechi, înregistrează ce a găsit modul de pornire și iese din el: bannerul dispare, iar navigarea arată Configurare, Administratori și Erori. Se deschide cardul Mapbox.
- Dacă permisiunea Google a expirat (peste o oră sau după reîncărcarea paginii), panoul de preluare cere un clic: **Confirmă cu Google**.

### e. Mapbox

- Creezi contul și ieși din planul demo pe paginile Mapbox (card și adresă de facturare; linkul cardului spune să alegi *Rotate token*), bifezi alertele de utilizare, apoi creezi tokenul secret `historic-map-server` cu permisiunile din card (**Copiază permisiunile**).
- Lipește tokenul în **Tokenul secret (sk.…)**: un token secret se salvează pe loc, fără alt clic (un token public `pk.` este explicat în loc și nu se trimite nimic; un token tastat de mână pleacă cu Enter sau **Salvează**, după ce cardul spune „Pare un token secret.”). Tokenul ajunge o singură dată în Secret Manager, iar aplicația creează tokenurile publice ale site-ului și ale administrării, restricționate la adresele lor.
- **Înlocuiește tokenul vizitatorilor** și **Înlocuiește tokenul administrării** (după ce Mapbox e salvat) fac un token public nou, după o confirmare; cardul spune când se șterge cel vechi (peste zece minute, ca paginile deschise să meargă în continuare). Folosește-le când un token a scăpat.
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
| „USGS este în mentenanță. Încearcă din nou mai târziu.” | mentenanță USGS | nimic: tokenul este păstrat și verificat din nou mai târziu |
| „Google Analytics nu este activat pentru proiect. …” | Analytics este oprit | activează-l în consola Firebase (linkul cardului) |
| „Fotografii neprocesate: N. Motivul apare lângă fiecare.” | o fotografie din pachet nu a putut fi procesată | **Verifică din nou** sau deschide fotografia în pagina Fotografii |

## Activitatea zilnică

Navigarea are Acasă, Configurare, Fotografii, Locuri, Straturi, Procesări, Setări, Administratori, Istoric și Erori (pe telefon, bara păstrează Configurare, Fotografii, Locuri și Straturi; restul sunt sub **Mai mult**). Toate editoarele funcționează la fel:

- **Liste și editoare.** De la 840 px lățime, lista stă în stânga și elementul deschis lângă ea; pe tabletă elementul înlocuiește lista, cu **Înapoi la listă**; pe telefon ocupă toată pagina, cu **Închide**. Adresa unui element (`#/photos/<id>`) poate fi salvată sau trimisă altui administrator.
- **Ciorne.** Ce modifici este o ciornă: harta paginii o arată imediat și nu se scrie nimic până la **Salvează**. Salvarea scrie o singură modificare, cu contul tău; harta publică urmează în aproximativ un minut. **Renunță la modificări** aduce înapoi versiunea salvată. Dacă pleci din pagină, te deconectezi sau reîncarci cu modificări nesalvate, aplicația te întreabă întâi (**Continuă editarea** sau **Renunță**); schimbarea limbii păstrează ciorna. Un câmp cu o problemă o spune sub el, iar Salvează rămâne oprit până o corectezi (și spune de ce); un număr (un an, o latitudine) contează pe măsură ce îl scrii și își spune problema după ce părăsești câmpul, așa că un an scris pe jumătate nu afișează o eroare.
- **Alt administrator a salvat același element între timp**: editorul îi spune numele și ora; câmpurile schimbate doar de el se adaugă, iar pentru câmpurile schimbate de amândoi alegi să le păstrezi pe ale tale sau să le iei pe ale lui. Un element șters între timp nu mai poate fi salvat; Istoricul îl restaurează.
- **Fiecare modificare rămâne în Istoric** (mai jos) și poate fi anulată cu un clic.
- **Înainte de cardul Mapbox** (fără tokenul administratorului), caseta hărții din editoare spune asta și duce la card; toate câmpurile și lista de puncte funcționează în continuare.

### Acasă

Ce conține orașul și ce te așteaptă (fotografii cu drepturi de verificat, fotografii nepublicate, procesări în lucru sau eșuate), fiecare cu link spre pagina lui, câte un indicator pentru fiecare zonă a Configurării și starea hărții publice. După ce configurarea e gata, aplicația se deschide aici (`docs/research/DECISIONS-for-review.md` §41c). **Nu sunt pe harta publică** enumeră fiecare element publicat pe care harta publică l-a lăsat deoparte, cu ce e de corectat și un link spre editorul lui.

### Fotografii

- **Adaugă fotografii** sau trage fișierele pe listă: JPEG, PNG, WebP și TIFF, până la 60 MB. Un fișier mai mare sau de alt tip este refuzat în pagină, înainte de orice încărcare. Se încarcă trei fișiere deodată, fiecare cu progresul lui; o încărcare întreruptă continuă, iar **Încearcă din nou** o reia.
- **Completate pentru tine**: titlul din numele fișierului; locul, anul și direcția din EXIF, pentru fotografiile pe care nu le-ai atins încă (un loc din afara orașului este ignorat); autorul, sursa, licența și deținătorul drepturilor din lotul tău anterior („Fotografiile noi primesc: …”). O fotografie fără loc ajunge la ultimul tău punct (sau în centrul orașului) și este marcată **Verifică locul** până îi muți punctul sau alegi **Confirmă locul**; până atunci, publicarea mai multor fotografii deodată o sare. După o reîncărcare, valorile EXIF neaplicate apar ca sugestii, cu **Aplică**.
- **Filtre**: Toate, Nepublicate, În procesare, Refuzate, Drepturi de verificat; **Caută după titlu sau autor**.
- **Editorul**: titlul și descrierea (româna obligatorie, engleza opțională: vizitatorii citesc atunci textul în română), data și anii, autorul, licența, deținătorul drepturilor, sursa, nota despre permisiune, până la 5 linkuri https, drepturile de verificat, **Publicată pe harta publică**. Când se deschide o fotografie, harta se centrează pe ea (cu zoomul păstrat). Locul: tragi punctul, dai clic pe hartă sau scrii latitudinea și longitudinea; **Alege direcția pe hartă**, apoi un clic pe ce privea aparatul (de la tastatură: **Spre centrul hărții**); glisorul **Unghiul de vedere** lărgește conul pe loc. O fotografie încărcată în această sesiune pornește cu Publicată activat (se publică la salvare); o fotografie încă în procesare, refuzată sau cu licență necunoscută nu poate fi publicată, iar comutatorul spune de ce.
- **Mai multe fotografii deodată**: le bifezi (sau **Selectează tot**), apoi **Publică**, **Retrage de pe hartă**, **Autor, sursă și licență**, confirmi drepturile sau **Șterge**. O fotografie pe care acțiunea nu o poate schimba rămâne cum era și este numită cu motivul ei (**Vezi de ce**).
- **Înlocuiește imaginea** (în editor): fișierul nou se procesează în timp ce imaginea veche rămâne pe harta publică, apoi îi ia locul dintr-odată. Un fișier refuzat lasă imaginea veche publicată și spune de ce; același fișier încă o dată nu schimbă nimic; **Anulează înlocuirea** oprește încărcarea.
- **Șterge fotografia** întreabă întâi; mesajul de după oferă **Anulează** timp de zece secunde, iar Istoricul o restaurează și mai târziu (una ale cărei fișiere publice au fost deja curățate este procesată din nou din originalul păstrat).
- Fotografiile HEIC de pe iPhone nu pot fi convertite încă pe server: pe iPhone alege Setări → Cameră → Formate → Cel mai compatibil, sau exportă fotografia ca JPEG. O fotografie identică cu una deja încărcată este marcată ca duplicat, cu link spre prima.

### Locuri

- **Adaugă loc**, apoi **Punct**, **Linie** sau **Suprafață**. Desenezi pe hartă (Enter sau un clic pe primul punct încheie o linie sau o suprafață, Esc șterge ultimul punct) sau folosești **lista de puncte**: **Adaugă în centru** pune un punct în centrul hărții (vederea de pornire a orașului, când nu există hartă), latitudinea și longitudinea se pot scrie, iar punctele se pot muta mai sus, mai jos sau șterge. Un punct din afara orașului, laturi care se intersectează, mai mult de 500 de puncte sau o formă fără suprafață sunt refuzate pe loc, fiecare cu motivul lui.
- **Un loc salvat** se deschide cu forma selectată, iar harta se centrează pe el (cu zoomul păstrat), așa că un loc din afara vederii de pornire a orașului apare imediat pe hartă. Tragi forma de interior ca s-o muți, un colț ca să muți acel punct sau bulina de la mijlocul unei laturi ca să adaugi acolo un punct; lista de puncte urmează fiecare tragere, iar Salvează o scrie. O tragere care ar face laturile să se intersecteze se oprește înainte.
- Categoria (pentru un loc nou, ultima pe care ai folosit-o), titlurile, descrierea în subsetul Markdown cu previzualizare (aldine, cursive, linkuri https; HTML-ul rămâne text simplu), anii (oricare poate rămâne gol), până la 5 linkuri, până la 20 de fotografii legate, **Publicat**. Un loc nou se publică la salvare; **Redesenează ca …** schimbă forma (după ce te întreabă).
- Indicatoarele de categorie, Nepublicate și căutarea după titlu filtrează lista. Mai multe locuri deodată: **Publică**, **Retrage de pe hartă**, **Mută în categoria…**, **Șterge**.
- **Exportă toate (GeoJSON)** salvează toate locurile (sau selecția) ca fișier `.geojson`. **Importă GeoJSON** citește un astfel de fișier (până la 5 MB) în pagină: o previzualizare numără locurile noi, schimbate, neschimbate și refuzate, fiecare refuz cu motivul lui (o formă nesuportată, o altitudine, un contur deschis, un punct din afara orașului, o categorie necunoscută, prea multe puncte); locurile fără o categorie cunoscută o primesc pe cea aleasă de tine; **Importă** le scrie (cel mult 5.000 de locuri în total). Un fișier exportat și importat din nou nu schimbă nimic.
- **Șterge locul** întreabă întâi; Istoricul îl restaurează.

### Straturi istorice

- Straturile sunt create de procesarea imaginilor (M3); până atunci pagina spune asta. Lista le arată în ordinea desenării (primul este desenat deasupra), cu starea lor și Publicat; tragi unul sau folosești **Mută mai sus** și **Mută mai jos**.
- **Editorul stratului**: eticheta și descrierea (româna, engleza opțională), atribuirea, anul și data, **Afișat la deschiderea hărții**, **Opacitate implicită** și patru ajustări ale imaginii, **Nivel de negru**, **Nivel de alb**, **Contrast** și **Saturație**, fiecare citită ca procent cu semn, cu **Resetează ajustările**. Fiecare glisor schimbă imediat harta paginii; Salvează publică valorile, iar vizitatorii văd exact ce ai văzut tu. Nivelul de negru nu trece niciodată de nivelul de alb.
- **Leagă un strat**: un tileset al contului Mapbox al orașului sau adresa https a unui server de dale. Tilesetul altui cont (inclusiv cele ale Mapbox) și o adresă care conține o cheie sunt refuzate înainte să se trimită ceva. **Verifică** cere serverului o dală din centrul orașului și spune ce a răspuns („Dalele răspund (image/png).”) sau de ce nu a răspuns nimic (nicio dală la această adresă, nu e o imagine, serverul nu răspunde); după o verificare eșuată, Leagă rămâne oprit până schimbi adresa. Un strat legat pornește nepublicat și ascuns la deschidere. Adresa unui server de dale trebuie permisă și în politica de securitate a conținutului a site-ului și a aplicației de administrare: dialogul o numește.
- **Șterge stratul** întreabă întâi: stratul dispare de pe harta publică în aproximativ un minut, iar tilesetul lui Mapbox este șters după șapte zile, dacă nu restaurezi stratul din Istoric între timp (procesarea care așteaptă se vede în pagina Procesări).
- **Imagine și geometrie** (un strat făcut din imagini): **Înlocuiește imaginea** deschide încărcarea din Imagini istorice pentru acest strat (alegi un GeoTIFF; nu ți se mai cere nimic, stratul își păstrează anul); **Georeferențiază din nou** deschide georeferențiatorul pe imaginea de acum a stratului; **Decupează** desenează pe harta stratului zona de păstrat, un clic pentru fiecare colț (de la tastatură: **Adaugă un colț în centrul hărții**), apoi **Salvează decuparea**; o zonă din afara stratului este refuzată. Fiecare face o versiune nouă: stratul își păstrează dalele până când versiunea este publicată, iar editorul arată între timp **O versiune nouă e în lucru: deschide-o**. Un strat pentru care se lucrează ceva nu poate fi șters până se termină.

### Setări

Fiecare secțiune are propriul Salvează.

- **Zona orașului**: harta de deasupra arată orașul și limitele lui; limitele se scriu sau se desenează: **Desenează zona pe hartă**, apoi apasă două colțuri opuse. Vederea de pornire: mută harta, apoi **Folosește vederea hărții**; zoomul minim și maxim. Limitele care ar lăsa fotografii sau locuri pe dinafară sunt refuzate, iar pagina le enumeră.
- **Texte**: numele, „Despre” și textul despre confidențialitate, în română și engleză (subsetul Markdown, previzualizat cum îl vor vedea vizitatorii; un link care nu e https este refuzat la rândul lui) și mențiunile (până la 50, în ordinea aleasă de tine).
- **Temă și hartă de bază**: culoarea de bază (o valoare hex, selectorul de culoare sau una din opt propuneri), previzualizată pe loc în toată aplicația de administrare până o salvezi sau renunți la ea (ori pleci din Setări); o culoare care ar face textul greu de citit este mutată la cea mai apropiată nuanță lizibilă, cu o notă. Harta de bază pe care o văd vizitatorii (Standard sau Standard Satellite); harta aplicației de administrare este mereu Standard.
- **Categorii de locuri**: adaugi una (eticheta în română; pictograma urmează cuvintele etichetei, „Fântâni” apă, „Biserici” o biserică, până alegi tu una; culoarea, opacitatea și eticheta în engleză au valori implicite), o editezi, le reordonezi, o ștergi. Selectorul oferă 30 de pictograme, prin care te miști cu săgețile; o culoare pe care pictograma albă s-ar vedea greu este mutată la o nuanță lizibilă. Ștergerea unei categorii folosite încă de locuri te întreabă întâi unde merg ele. Pagina spune când ai ajuns la limită.
- **Imagini istorice**: dacă un cadru georeferențiat se publică fără niciun clic când eroarea la punctele de control este sub prag (pornit implicit), pragul acesta în metri (1–200, implicit 15) și anii pe care căutarea îi pune primii (cel mult 20, fiecare cu **Scoate**; ai Bucureștiului sunt 1966, 1976, 1977, 1978 și 1980: îi adaugi aici o dată). Se salvează separat.
- **Opacități implicite**: opacitatea cu care pornește fiecare strat suprapus (fiecare strat istoric, fotografiile, fiecare categorie de locuri) și, pentru straturi, dacă apar la deschidere, fiecare schimbare văzută pe harta de deasupra; un singur Salvează le scrie pe toate, Renunță la modificări le aduce înapoi pe cele salvate. Linkul unui vizitator care fixează o opacitate are în continuare prioritate.

### Istoric

- **Istoric** arată modificările orașului, cele mai noi primele, cu cine și când le-a făcut; filtrezi după ce s-a schimbat (fotografii, locuri, straturi, categorii de locuri, setările orașului) și după felul modificării (modificate, create, șterse, aduse înapoi). Linkul de istoric al unei fotografii sau al unui loc deschide versiunile lui, fiecare cu câmpurile schimbate, înainte și după.
- **Readu această versiune** (după ce te întreabă) aduce înapoi câmpurile acelei versiuni; versiunea de acum rămâne în Istoric, deci și revenirea se poate anula. Cu filtrul pe **Șterse**, fiecare element șters oferă **Restaurează**. O versiune pe care regulile de azi o refuză nu este adusă înapoi, iar pagina spune de ce.

### Procesări

Lista procesărilor, actualizată pe loc (În lucru, Eșuate, Încheiate), cu progresul lor; pașii și jurnalul unei procesări pe măsură ce apar; **Anulează procesarea** (după ce te întreabă) cât timp rulează. Ștergerea unui strat așteaptă cu data ei („Rulează după …, odată cu procesarea imaginilor.”). O procesare de imagini își numește fiecare pas, spune de ce așteaptă și până când (USGS pregătește descărcarea sau e în mentenanță, bugetul Mapbox al lunii, punctele tale), oferă **Rulează din nou** când a eșuat (cel mult trei încercări; pașii deja făcuți nu se mai fac) și **Deschide georeferențiatorul** când așteaptă punctele tale.

### Administratori

- **Invită** un administrator cu adresa contului său Google: se păstrează doar amprenta ei; linkul se copiază singur când se face invitația (**Copiază linkul** îl copiază din nou), iar tu îl trimiți. Invitația expiră după 14 zile și poate fi anulată. Persoana invitată deschide linkul, se conectează cu acel cont Google și alege **Alătură-te**.
- **Retrage accesul** întreabă întâi și numește administratorul. De atunci, acel administrator nu mai poate salva nimic: următoarea lui salvare este refuzată. Dacă edita ceva, pagina lui rămâne cum era, cu modificările lui, doar pentru citire (Salvează și orice acțiune sunt oprite), sub mesajul „Accesul tău a fost retras: nu se mai salvează nimic. Copiază ce-ți trebuie, apoi deconectează-te.” și **Deconectează-te** (nu se mai trimite nimic); altfel aplicația îi spune că acel cont nu mai este administrator. Proprietarul nu poate fi eliminat și nimeni nu se poate elimina singur, așa că harta are mereu un administrator.

### Erori

Erorile întâlnite de vizitatori și de administratori, grupate, pe 24 de ore, 7 zile sau 30 de zile, cu numărul și versiunile lor (versiunea aplicației de administrare îi numește numărul și commitul din care a fost construită, de pildă `0.0.0+5d02329`); un grup arată când a apărut prima și ultima dată, iar mesajul și stiva ca text simplu, fără date personale, iar **Deschide în Error Reporting** deschide acel grup în consola Google Cloud. Când Error Reporting este oprit în proiect, pagina spune asta și duce la cardul de statistici al Configurării.

### De la Salvează la harta vizitatorilor

Fiecare salvare a ceva publicat cere serverului să refacă datele hărții publice (manifestul), cel mult o dată pe minut; vizitatorii văd schimbarea la următoarea vizită. Testele cap-coadă verifică tot lanțul pe emulatoare: o fotografie publicată, redenumită, adusă înapoi și retrasă; un loc adăugat de la tastatură; opacitatea implicită, afișarea la deschidere și ajustările unui strat; fiecare ajunge în harta construită exact cum a fost salvat (scenariile S-A41-*).

### Imagini istorice (M3)

Cadrele de satelit declasificate ale USGS (Corona, Gambit, Hexagon; 1960–1984) devin straturi istorice ale hărții. De obicei e un singur clic: **Importă (gratuit)**, iar serverul face restul.

- **Găsește**: prima dată când deschizi **Imagini istorice** (și apoi o dată pe lună), aplicația caută în cele trei colecții declasificate ale USGS peste zona orașului și ordonează scenele de la 0 la 100, întâi cele gratuite (scanate deja); fiecare spune de ce, în cuvinte simple (cât acoperă din oraș, gratuită sau de comandat, un an pe care orașul îl vrea, nori, detaliu, un an care are deja un strat). Filtre: **Doar gratuite** (pornit), **Ascunde respinsele**, cele trei colecții, din anul și până în anul; harta desenează conturul fiecărei scene din listă. **Caută din nou la USGS** caută iar. Când nu găsește nimic, pagina propune toți anii, toate cele trei colecții, și scenele de comandat, și zona orașului din Setări (căutarea acoperă doar zona aceea).
- **Importă (gratuit)** pe cardul unei scene sau în pagina ei (previzualizarea USGS, datele ei și fiecare motiv al scorului). Serverul descarcă cadrul, îl despachetează și îi unește părțile, găsește orașul pe el, pregătește referința (OpenStreetMap și Sentinel-2, niciodată Mapbox Satellite), potrivește singur puncte de control, îl proiectează pe hartă și îl exportă. Pagina versiunii arată fiecare pas pe măsură ce rulează, jurnalul și **Anulează** (după ce te întreabă; procesarea Mapbox nu se poate opri). Mentenanța USGS face importul să aștepte, nu să eșueze.
- **Publicarea**: când eroarea la punctele de control (punctele lăsate în afara potrivirii) este sub pragul orașului, implicit 15 m, se publică fără alt clic. Altfel, cardul de aprobare arată eroarea potrivirii și pe cea la punctele de control, perechile, unitățile de calcul Mapbox pe care le costă și pe cele rămase luna aceasta, cu **Aprobă și publică** și **Respinge** (după ce te întreabă). Un GeoTIFF încărcat care își are propria georeferențiere așteaptă mereu Aprobă: eroarea lui nu se poate măsura.
- **Peste unitățile de calcul gratuite ale lunii** (20 pe lună; o publicare costă după suprafață și zoom): cardul oferă trei căi, fiecare spunând ce înseamnă: **Gratuit: încarcă fișierul în Mapbox Studio** (1. **Descarcă fișierul**, 2. deschide Mapbox Studio și încarcă-l ca set de dale, 3. **L-am încărcat**: aplicația găsește setul după nume), **Așteaptă luna viitoare** sau **Publică acum, cu un cost de circa X USD** (după ce te întreabă; niciodată peste cele 24 de seturi de dale ale Mapbox).
- **Prea puține puncte potrivite**: importul așteaptă punctele tale („Puncte sigure găsite de georeferențierea automată: N, prea puține”): **Deschide georeferențiatorul**.
- **Un fișier prea mare pentru Mapbox**: cardul de aprobare spune asta și oferă singura cale care merge, încărcarea gratuită în Mapbox Studio a copiei mai mici. **La cele 24 de seturi de dale ale Mapbox**: nici plata, nici așteptarea nu eliberează un loc; ștergi un strat de care nu mai ai nevoie (**Deschide Straturile**) sau folosești Studio.
- **Când ceva eșuează**, pagina versiunii oferă ce îl rezolvă: **Încearcă din nou** când o nouă rulare poate ajuta (cel mult trei rulări și șase porniri ale publicării), **Deschide pasul Mapbox din Configurare** când Mapbox a refuzat tokenul sau permisiunile lui, **Încarcă alt fișier** când serverul a refuzat încărcarea ta și **Renunță la versiune** (cu întrebare) ca să scoți o versiune eșuată din **Așteaptă după tine**. **Anulează** merge până când Mapbox este rugat să publice.
- **Georeferențiatorul**: scanarea și harta de referință una lângă alta (pe telefon pe rând, cu **Scanare** și **Hartă**; o jumătate de pereche arată singură celălalt panou). Dai clic pe un loc pe scanare, apoi pe același loc pe hartă, sau de la tastatură: muți scanarea cu săgețile și harta la același loc, apoi **Adaugă la centre**, și tot așa pentru perechea următoare; o pereche aleasă în tabel se mută cu săgețile (Shift: de zece ori mai departe), **Esc** o lasă și **Delete** o șterge; fiecare pereche recalculează pe loc: tabelul perechilor (fiecare cu de unde vine, **în potrivire** sau păstrată ca punct de control, și eroarea ei în metri; ordonat după pereche sau după eroare), eroarea potrivirii și cea la punctele de control, cu un avertisment peste prag, transformările pe care le permit perechile (afină de la 3, polinom de gradul doi de la 6, spline cu plăci subțiri) și previzualizarea proiectată pe hartă. Perechile așezate pe o linie sunt refuzate. **Salvează și georeferențiază** continuă importul care așteaptă sau face o versiune nouă a unui strat publicat.
- **Încărcare**: **Încarcă un GeoTIFF** (până la 8 GB; pagina îi citește primii octeți și refuză orice nu este TIFF înainte să-l trimită). Un nume cu un an („Plan 1911.tif”) pornește încărcarea imediat, altfel pagina cere anul. O încărcare mare continuă după ce conexiunea cade. Un GeoTIFF cu propria georeferențiere ajunge la cardul de aprobare; o scanare fără ea așteaptă punctele în georeferențiator.
- **Până când USGS îți aprobă descărcările** (24–48 de ore lucrătoare după cererea M2M): rezultatele apar, Importă este oprit, iar pagina spune de ce, cu drumul spre pasul USGS din Configurare. Un token refuzat de USGS duce la același pas.
- Limite: 10 importuri pe zi și 2 în lucru deodată, pe proiect.
- **Oprită de protecția bugetului**: când costul Google Cloud al lunii ajunge la buget, importurile, reîncercările, salvările georeferențiatorului, decupările și publicările se opresc (harta publică niciodată). **Imagini istorice** și **Procesări** spun asta, cu costul și bugetul, iar **Reia procesarea** (cu întrebare) le pornește din nou pentru restul lunii; alerta lunii viitoare le oprește iar.

## Costuri

- Google Cloud: aproximativ 0,5–2 $ pe lună; bugetul de 5 $ oprește automat procesarea imaginilor (niciodată site-ul), iar **Reia procesarea** din Imagini istorice sau Procesări o pornește din nou pentru restul lunii.
- Mapbox: gratuit până la 50.000 de încărcări de hartă pe lună; publicarea unui strat istoric costă unități de calcul după suprafața și zoomul lui, iar aplicația rămâne în cele 20 gratuite ale lunii, altfel îți oferă încărcarea gratuită prin Studio, așteptarea lunii viitoare sau plata sumei pe care o numește.
- USGS: cadrele scanate sunt gratuite; o scanare nouă costă 30 $ pe cadru plus 5 $ pe comandă.

## Probleme frecvente

Mesajul afișat, cauza și ce trebuie făcut, pentru fiecare ecran.

### Editoarele (din M2c)

| Mesaj | Cauză | Ce faci |
| --- | --- | --- |
| un mesaj sub un câmp, iar Salvează oprit | câmpul încalcă o regulă (un titlu în română gol, un an de sfârșit înaintea celui de început, un link care nu e https, un loc în afara orașului) | corectezi câmpul numit; Salvează pornește când nu mai e nicio problemă |
| editorul numește alt administrator și ora | celălalt a salvat același element între timp | păstrezi câmpurile tale sau le iei pe ale lui, apoi Salvează |
| „Ești offline: nu s-a salvat nimic. …” | conexiunea s-a pierdut | Salvează din nou când revine; ciorna rămâne |
| „Accesul a fost refuzat. …”, apoi „Acest cont Google nu administrează harta. …” | accesul tău a fost retras | ceri altui administrator o invitație nouă |
| „Harta apare după ce configurezi Mapbox.” | cardul Mapbox nu e gata (nu există tokenul administratorului) | termini cardul Mapbox; până atunci scrii locurile în câmpuri |
| „Imaginea nouă a fost refuzată, iar cea veche rămâne publicată.” | fișierul de înlocuire nu a trecut verificarea serverului | alegi alt fișier (motivul apare lângă mesaj) |
| tilesetul aparține altui cont Mapbox | **Leagă un strat** cu tilesetul altui cont | legi un tileset al contului Mapbox al orașului |
| o categorie nu se poate șterge | locuri o folosesc încă | alegi categoria în care se mută locurile, apoi Șterge |

### Imagini istorice (din M3)

| Mesaj | Cauză | Ce faci |
| --- | --- | --- |
| „USGS este în mentenanță. Încearcă din nou mai târziu.” | mentenanța programată a USGS | un import așteaptă și continuă singur; pentru căutare, **Încearcă din nou** mai târziu |
| „USGS nu răspunde. Încearcă din nou mai târziu.” | USGS nu a răspuns la căutare | **Încearcă din nou** |
| „USGS a refuzat utilizatorul sau tokenul. …” | tokenul aplicației USGS a expirat sau a fost înlocuit | **Deschide pasul USGS din Configurare** și lipești un token nou în 60 de secunde |
| „USGS nu a aprobat încă accesul M2M pentru acest cont. …” | rolul de descărcare M2M este încă în analiză | aștepți; aplicația verifică la fiecare 6 ore, iar Importă revine singur |
| „USGS nu a găsit nicio scenă peste zona orașului.” | filtrele sau zona nu lasă nimic | încerci toți anii, toate cele trei colecții, și scenele de comandat, sau verifici zona orașului în Setări |
| „Puncte sigure găsite de georeferențierea automată: N, prea puține. …” | cadrul are prea puține repere în care potrivirea are încredere | **Deschide georeferențiatorul** și împerechezi câteva repere |
| „Procesarea e oprită: costul Google Cloud al lunii a ajuns la … din bugetul de ….” | alerta de buget a oprit procesarea imaginilor | **Reia procesarea** (poate costa în plus luna aceasta) sau aștepți luna viitoare |
| „Imaginea nu a putut fi procesată. …” | un pas al procesării a eșuat pe fișierele serverului | **Încearcă din nou**; dacă eșuează iar, deschide jurnalul lucrării |
| „Mapbox a refuzat tokenul: …” / „Tokenului îi lipsesc permisiunile: …” | tokenul secret Mapbox s-a schimbat | **Deschide pasul Mapbox din Configurare** și lipește un token cu permisiunile numite |
| „Nu încape în bugetul Mapbox al lunii: alege cum continuăm” | publicarea costă mai multe unități de calcul decât au rămas | încărcarea gratuită prin Studio, luna viitoare sau plata |
| „Fișierul nu este un GeoTIFF. Încarcă un fișier .tif.” | fișierul ales este alt fel de imagine | îl exporți întâi ca GeoTIFF |
| „Sursa nu are dale la această adresă (404).” / „Adresa nu răspunde cu o imagine.” / „Serverul de dale nu răspunde.” | **Verifică** pe adresa unor dale în **Leagă un strat** | corectezi adresa (trebuie să conțină `{z}`, `{x}`, `{y}`) sau încerci mai târziu |

### Harta publică (din M1)

Când pagina orașului nu poate afișa harta, arată un card cu unul dintre mesajele de mai jos, în limba vizitatorului. Cele pe care le poate rezolva administratorul orașului:

| Mesaj | Cauză | Ce faci |
| --- | --- | --- |
| „Harta nu a fost găsită. Încearcă din nou mai târziu.” | pagina nu a găsit `manifest.json` la adresa din `config.js` | publici orașul (M2) sau corectezi `manifestUrl` în `config.js` |
| „Datele hărții sunt nevalide (probleme găsite: N).”, urmat de `câmp: regulă` | manifestul încalcă o regulă din City Manifest v1; cardul numește primul câmp și regula | corectezi acel câmp (în aplicația de administrare din M2; pe un site făcut din kitul de pornire, în `data/manifest.json`) |
| „Lipsește config.js” / „config.js este nevalid: …” | pagina nu are `window.HistoricCityMapConfig` sau un câmp din el este necunoscut ori greșit | compari `config.js` cu cel din kitul de pornire (`starter-kit/README.md`) |
| „cityId din config.js (…) nu corespunde hărții (…).” | `config.js` arată spre manifestul altui oraș | faci `cityId` și orașul din manifest să fie același; site-ul București numește orașul proiectului `bucharest`, ca orice manifest construit de server (`bucuresti` al vechiului seed e redenumit de construirea site-ului, `docs/research/DECISIONS-for-review.md` §35b) |
| „Această hartă are nevoie de o versiune mai nouă a paginii (X). Reîncarcă pagina mai târziu.” | manifestul cere un motor mai nou decât cel încărcat de pagină | încarci versiunea de motor din mesaj |
| „Browserul tău nu poate afișa harta interactivă. Lista fotografiilor rămâne disponibilă.” | browserul vizitatorului nu are WebGL | nimic: vizitatorul primește în continuare lista fotografiilor |
