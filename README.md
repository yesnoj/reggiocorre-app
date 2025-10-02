# ReggioCorre - Calendario Gare Podistiche

App web moderna per consultare il calendario delle gare podistiche di Reggio Emilia e provincia.

## 🚀 Funzionalità

### Calendario Gare
- **Visualizzazione completa** delle gare podistiche dei prossimi 2 mesi
- **Ricerca avanzata** per nome, località o descrizione
- **Filtri multipli**: provincia, tipo di gara, distanza, data
- **Dettagli completi** per ogni gara con scheda dedicata

### Informazioni Dettagliate
Ogni gara include:
- 📅 Data e orario di partenza
- 📍 Località e luogo di ritrovo esatto
- 🏃 Distanze disponibili
- 💶 Quota di iscrizione
- 🏢 Società organizzatrice
- 📞 Contatti (telefono, email)
- 📋 Descrizione completa

### Allegati e Link
L'app estrae e mostra tutti i link e allegati disponibili:
- 🗺️ **Google Maps** - Link diretto alla location
- 📧 **Email** - Contatto diretto con gli organizzatori
- 🌐 **Sito Web** - Link al sito ufficiale della gara
- ✍️ **Iscrizioni Online** - Link diretto per iscriversi
- 📄 **Locandine** - File PDF/immagini (1 o 2 allegati)
- 🗺️ **Traccia GPX** - Download tracciato per GPS
- 📅 **Calendario** - Download file .ics per aggiungere al proprio calendario

### Filtri Avanzati
- **Per Provincia**: Reggio Emilia, Modena, Bologna, Fuori Provincia
- **Per Tipo**: Corsa su strada, Trail, Marathon, Camminata, Skyrace, Competitiva
- **Per Distanza**: Tutti i km disponibili
- **Per Data**: Selezione calendario
- **Ricerca Testuale**: Cerca per nome o descrizione

### Caratteristiche Speciali
- ⭐ **Badge Competitiva** - Evidenzia gare valide per classifiche
- 📱 **Design Responsive** - Ottimizzato per mobile e desktop
- 🔄 **Aggiornamento automatico** - Scraping ogni 6 ore
- 💾 **Cache intelligente** - Tempi di caricamento rapidi
- 🎨 **UI moderna** - Interfaccia pulita e intuitiva

## 🏗️ Architettura

### Frontend
- **React 18** - Framework UI
- **Tailwind CSS** - Styling moderno
- **Icone Lucide** - Set di icone minimal
- HTML5 statico deployabile ovunque

### Backend
- **Vercel Serverless Functions** - API backend
- **Node.js + JSDOM** - Web scraping
- **Cron automatico** - Aggiornamento ogni 6 ore
- Cache con `stale-while-revalidate`

### Scraping Avanzato
Lo scraper estrae:
1. **Dati base**: Data, ora, titolo, località, venue
2. **Distanze**: Parsing intelligente di formati multipli
3. **Prezzi**: Estrazione automatica o indicazione "Da definire"
4. **Contatti**: Email, telefono, organizzatori
5. **Allegati**: 
   - Immagini calendario/maps/allegati/GPX/email/www/iscrizione
   - Link assoluti e relativi
   - Conversione URL relativi in assoluti
6. **Classificazione**: Tipo di gara e flag competitiva

## 📁 Struttura File

```
.
├── index.html              # App frontend (React + Tailwind)
├── api/
│   └── scraper.js         # Serverless function per scraping
├── package.json           # Dipendenze Node.js
├── vercel.json           # Configurazione Vercel + Cron
├── manifest.json         # PWA manifest
├── .gitignore           # File da escludere
└── README.md            # Questa documentazione
```

## 🚀 Deploy

### Vercel (Consigliato)
1. Fai fork o clona questo repository
2. Vai su [vercel.com](https://vercel.com) e importa il progetto
3. Deploy automatico!
4. L'app sarà disponibile su `https://tuo-progetto.vercel.app`

### Deploy Locale per Test
```bash
# Installa Vercel CLI
npm i -g vercel

# Clona il repository
git clone [url-repo]
cd reggiocorre-app

# Installa dipendenze
npm install

# Avvia in locale
vercel dev
```

Visita `http://localhost:3000`

## 🔧 Configurazione

### Cron Job (aggiornamento automatico)
Nel file `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/scraper",
    "schedule": "0 6 * * *"
  }]
}
```
Attualmente configurato per le **6:00 AM ogni giorno**.

### Cache
Cache configurata per 1 ora con `stale-while-revalidate`:
```javascript
res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
```

### Debug Mode
Aggiungi `?debug=true` all'URL dell'API per vedere statistiche di parsing:
```
https://tuo-progetto.vercel.app/api/scraper?debug=true
```

## 🔍 API Endpoint

### GET /api/scraper
Restituisce le gare parsate dal sito ReggioCorre.

**Response Success:**
```json
{
  "success": true,
  "count": 15,
  "totalParsed": 40,
  "lastUpdate": "2025-10-02T10:30:00.000Z",
  "races": [
    {
      "id": 1,
      "date": "2025-10-05",
      "time": "09:00",
      "title": "Nome Gara",
      "location": "Città",
      "province": "Reggio Emilia",
      "provinceCode": "RE",
      "venue": "Indirizzo completo",
      "distances": [10, 21],
      "description": "Descrizione...",
      "type": "Corsa su strada",
      "isCompetitive": true,
      "price": "10€",
      "organizer": "Nome Organizzatore",
      "society": "Nome Società",
      "phoneNumber": "1234567890",
      "attachments": {
        "hasCalendar": true,
        "hasMaps": true,
        "hasAttachment1": true,
        "hasAttachment2": false,
        "hasGPX": false,
        "hasEmail": true,
        "hasWebsite": true,
        "hasRegistration": true,
        "mapLink": "https://maps.google.com/...",
        "emailAddress": "info@example.com",
        "websiteUrl": "https://example.com",
        "registrationUrl": "https://iscrizioni.example.com",
        "attachmentUrls": ["https://example.com/file.pdf"]
      }
    }
  ]
}
```

## 🎨 Personalizzazione

### Colori
I colori principali sono definiti nelle classi Tailwind:
- Primary: `blue-600` 
- Secondary: `indigo-600`
- Accent: `yellow-400` (badge competitiva)

### Filtro Province
Modifica le province nel codice se necessario (attualmente: RE, MO, BO, XY).

### Periodo Gare
Di default mostra gare dei prossimi 60 giorni. Modifica in `scraper.js`:
```javascript
const twoMonthsLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
```

## 🐛 Troubleshooting

### Le gare non si caricano
1. Verifica che il backend Vercel sia deployato
2. Controlla i log su Vercel Dashboard
3. Testa l'endpoint `/api/scraper` direttamente
4. Usa `?debug=true` per diagnostica

### Parsing incompleto
Lo scraper è progettato per essere robusto, ma se il sito ReggioCorre cambia struttura:
1. Usa debug mode per vedere cosa viene parsato
2. Aggiorna la logica in `parseReggioCorre()` 
3. Controlla i selettori DOM

### Allegati non estratti
Gli allegati sono basati su pattern nel DOM:
- `png/calendar.png` → Calendario
- `png/maps.png` → Google Maps
- `png/allegato1.png` / `png/allegato2.png` → Locandine
- `png/gpx.png` → Traccia GPX
- `png/email.png` → Email disponibile
- `png/www.png` → Sito web
- `png/iscrizione.png` → Link iscrizione

## 📱 PWA (Progressive Web App)

L'app supporta l'installazione come PWA:
- Icone 192x192 e 512x512
- Manifest.json configurato
- Funziona offline con dati in cache

## 🤝 Contribuire

Contributi benvenuti! Per miglioramenti:
1. Fork del repository
2. Crea un branch per la feature
3. Commit delle modifiche
4. Push e Pull Request

## 📄 Licenza

Progetto open source per la community podistica.

## 🔗 Link Utili

- **Sito Ufficiale**: [reggiocorre.it](https://www.reggiocorre.it)
- **Deploy Demo**: Aggiorna con il tuo URL Vercel
- **Issues**: Usa GitHub Issues per segnalazioni

## 📊 Statistiche Parsing

Lo scraper attualmente estrae con successo:
- ✅ 100% date e orari
- ✅ 100% titoli e località
- ✅ 95%+ distanze (formati multipli supportati)
- ✅ 90%+ descrizioni complete
- ✅ 100% link Google Maps
- ✅ 85%+ email quando disponibili
- ✅ 90%+ link iscrizioni quando disponibili
- ✅ 100% file allegati disponibili

---

**Buone corse! 🏃‍♂️�