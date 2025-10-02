function parseReggioCorre(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const races = [];
  
  // Trova tutti i blocchi di gara nel DOM
  const tableRows = document.querySelectorAll('table tr');
  
  let currentRace = null;
  let id = 1;
  
  for (const row of tableRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) continue;
    
    const firstCell = cells[0];
    const text = firstCell.textContent.trim();
    
    // Cerca pattern data: formato dd/mm
    const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
    
    if (dateMatch && cells.length >= 2) {
      // Salva la gara precedente se esiste
      if (currentRace && currentRace.title && currentRace.distances.length > 0) {
        races.push(currentRace);
      }
      
      // Inizia nuova gara
      const [_, day, month] = dateMatch;
      const year = new Date().getFullYear();
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // La seconda cella contiene tutto il resto
      const contentCell = cells[1];
      const contentText = contentCell.textContent;
      const contentLines = contentText.split('\n').map(l => l.trim()).filter(l => l);
      
      // Estrai giorno della settimana (es. "sab", "dom")
      const dayOfWeek = contentLines[0] || '';
      
      // Estrai orario (cerca pattern HH:MM)
      let time = '09:00';
      const timeMatch = contentText.match(/(\d{1,2}:\d{2})/);
      if (timeMatch) time = timeMatch[1];
      
      // Estrai titolo (la riga più lunga che non è un orario o coordinate)
      let title = '';
      for (const line of contentLines) {
        if (line.length > title.length && 
            !line.match(/^\d{1,2}:\d{2}$/) && 
            !line.match(/^[A-Z]{2}$/) &&
            line.length > 10) {
          title = line;
        }
      }
      
      // Estrai venue (cerca indirizzo con virgola)
      let venue = '';
      for (const line of contentLines) {
        if (line.includes(',') && line.length > 15) {
          venue = line;
          break;
        }
      }
      
      // Estrai location dalla venue
      let location = venue;
      if (venue.includes(',')) {
        const parts = venue.split(',');
        location = parts[parts.length - 1].trim();
      }
      
      // Determina provincia dal testo
      let province = 'XY';
      let provinceName = 'Fuori Provincia';
      
      if (contentText.includes('(PR)') || location.includes('(PR)')) {
        province = 'XY';
        provinceName = 'Fuori Provincia';
      } else if (contentText.match(/\b(Reggio|Cavriago|Toano|Vezzano|Quattro Castella|Correggio)\b/i)) {
        province = 'RE';
        provinceName = 'Reggio Emilia';
      } else if (contentText.match(/\b(Modena|Formigine|Sassuolo|Maranello|Montefiorino|Finale Emilia|Pievepelago|Cittanova)\b/i)) {
        province = 'MO';
        provinceName = 'Modena';
      } else if (contentText.match(/\b(Bologna)\b/i)) {
        province = 'BO';
        provinceName = 'Bologna';
      }
      
      // Estrai descrizione (tutto il testo meno titolo e venue)
      let description = contentText
        .replace(title, '')
        .replace(venue, '')
        .replace(/\d{1,2}:\d{2}/g, '')
        .replace(/png\/\w+\.png/g, '')
        .replace(/Aggiungi al Calendario/g, '')
        .replace(/Google Maps/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 5)
        .join(' ')
        .trim();
      
      // Estrai distanze
      const distances = [];
      const distanceMatch = contentText.match(/(\d+[\.,]?\d*)\s*[-–]\s*(\d+[\.,]?\d*)\s*[-–]?\s*(\d+[\.,]?\d*)?/);
      if (distanceMatch) {
        for (let i = 1; i < distanceMatch.length; i++) {
          if (distanceMatch[i]) {
            const dist = parseFloat(distanceMatch[i].replace(',', '.'));
            if (!isNaN(dist) && dist > 0 && dist < 200) {
              distances.push(dist);
            }
          }
        }
      }
      
      // Se non trovate con regex, cerca pattern semplice
      if (distances.length === 0) {
        const simpleDistMatch = contentText.match(/(\d+[\.,]?\d*)\s*km/gi);
        if (simpleDistMatch) {
          for (const match of simpleDistMatch) {
            const dist = parseFloat(match.replace(',', '.').replace(/[^\d\.]/g, ''));
            if (!isNaN(dist) && dist > 0 && dist < 200 && !distances.includes(dist)) {
              distances.push(dist);
            }
          }
        }
      }
      
      // ESTRAZIONE ALLEGATI E LINK
      const attachments = {
        hasCalendar: false,
        hasMaps: false,
        hasAttachment1: false,
        hasAttachment2: false,
        hasGPX: false,
        hasEmail: false,
        hasWebsite: false,
        hasRegistration: false,
        
        // Link estratti
        mapLink: venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}` : null,
        emailAddress: null,
        websiteUrl: null,
        registrationUrl: null,
        attachmentUrls: []
      };
      
      // Cerca immagini e link nel HTML
      const images = contentCell.querySelectorAll('img');
      const links = contentCell.querySelectorAll('a');
      
      for (const img of images) {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        
        if (src.includes('calendar.png') || alt.includes('Calendario')) {
          attachments.hasCalendar = true;
        }
        if (src.includes('maps.png') || alt.includes('Maps')) {
          attachments.hasMaps = true;
        }
        if (src.includes('allegato1.png') || alt.includes('Allegato')) {
          attachments.hasAttachment1 = true;
        }
        if (src.includes('allegato2.png')) {
          attachments.hasAttachment2 = true;
        }
        if (src.includes('gpx.png') || alt.includes('GPX')) {
          attachments.hasGPX = true;
        }
        if (src.includes('email.png') || alt.includes('Email')) {
          attachments.hasEmail = true;
        }
        if (src.includes('www.png') || alt.includes('Www')) {
          attachments.hasWebsite = true;
        }
        if (src.includes('iscrizione.png') || alt.includes('Iscrizione')) {
          attachments.hasRegistration = true;
        }
      }
      
      // Estrai email dalla descrizione
      const emailMatch = description.match(/[\w\.-]+@[\w\.-]+\.\w+/);
      if (emailMatch) {
        attachments.emailAddress = emailMatch[0];
      }
      
      // Estrai telefono
      const phoneMatch = description.match(/(\d{3}[\s\-]?\d{3}[\s\-]?\d{4}|\d{10})/);
      const phoneNumber = phoneMatch ? phoneMatch[0].replace(/\s|-/g, '') : null;
      
      // Estrai URL dai link
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        
        if (href.includes('maps.google') || href.includes('google.com/maps')) {
          attachments.mapLink = href;
        } else if (href.includes('mailto:')) {
          attachments.emailAddress = href.replace('mailto:', '');
        } else if (href.includes('http') && !href.includes('reggiocorre.it')) {
          if (href.match(/iscrizione|signup|register|iscriviti/i) || attachments.hasRegistration) {
            attachments.registrationUrl = href;
          } else if (attachments.hasWebsite) {
            attachments.websiteUrl = href;
          } else {
            attachments.attachmentUrls.push(href);
          }
        } else if (href.includes('.pdf') || href.includes('.jpg') || href.includes('.png') || href.includes('.gpx')) {
          // Converti URL relativi in assoluti
          const absoluteUrl = href.startsWith('http') ? href : `https://www.reggiocorre.it/${href}`;
          attachments.attachmentUrls.push(absoluteUrl);
        }
      }
      
      // Determina il tipo di gara
      let type = 'Corsa su strada';
      const descLower = (title + ' ' + description).toLowerCase();
      if (descLower.includes('trail')) type = 'Trail';
      else if (descLower.includes('camminata')) type = 'Camminata';
      else if (descLower.includes('skyrace')) type = 'Skyrace';
      else if (descLower.includes('marathon') || descLower.includes('maratona')) type = 'Marathon';
      else if (descLower.includes('competitiv')) type = 'Competitiva';
      
      const isCompetitive = descLower.includes('competitiv') || descLower.includes('grand prix');
      
      // Estrai prezzo
      let price = 'Da definire';
      const priceMatch = description.match(/(\d+)\s*€/);
      if (priceMatch) price = `${priceMatch[1]}€`;
      else if (descLower.includes('gratuito') || descLower.includes('gratis') || descLower.includes('libera')) price = 'Gratuito';
      
      // Estrai organizzatore
      let organizer = null;
      const organizerMatch = description.match(/Organizzatore:\s*([^-\n]+)/i);
      if (organizerMatch) {
        organizer = organizerMatch[1].trim();
      }
      
      // Estrai società
      let society = null;
      const societyMatch = description.match(/Societ[àa] o gruppo sportivo:\s*([^\n]+)/i);
      if (societyMatch) {
        society = societyMatch[1].trim();
      }
      
      currentRace = {
        id: id++,
        date,
        time,
        title: title.replace(/\d+°|\d+ª|\d+\^/g, '').trim(),
        location: location.trim(),
        province: provinceName,
        provinceCode: province,
        venue: venue.trim(),
        distances: [...new Set(distances)].sort((a, b) => a - b),
        description: description.trim(),
        type,
        isCompetitive,
        price,
        organizer,
        society,
        phoneNumber,
        attachments
      };
    }
  }
  
  // Aggiungi l'ultima gara
  if (currentRace && currentRace.title && currentRace.distances.length > 0) {
    races.push(currentRace);
  }
  
  return races;
}