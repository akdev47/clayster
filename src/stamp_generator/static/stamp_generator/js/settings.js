// ============================================================================
// Clayster settings / Clayster-instellingen
// ============================================================================
//
// EN: Every number you may want to tweak lives here, in one place. Customers
//     cannot change these values; developers can. Change a number, reload the
//     page, done. Modules import what they need from SETTINGS; the input
//     fields on the page get their min/max/step from here too (see
//     applyInputLimits and the data-limits attributes in index.html).
//
//     Units are in the name: Mm = millimetres, Percent = percent. A range is
//     { default, min, max, step }: `default` is the starting value, `min` and
//     `max` are the limits of the field or slider, `step` is its step size.
//
//     NOT here on purpose: the internal geometry tolerances (for example
//     GEOMETRY_TOLERANCE_MM and OVERLAP). They depend on each other, and a
//     wrong value makes the 3D calculation fail instead of changing the
//     design. Prices live in src/orders/pricing.py.
//
//     A wrong value (min above max, a default outside its range, ...) stops
//     the page at load with a message naming the setting, see
//     validateSettings() at the bottom of this file.
//
// NL: Alle getallen die je misschien wilt aanpassen staan hier, op één plek.
//     Klanten kunnen deze waarden niet veranderen, ontwikkelaars wel. Pas een
//     getal aan, laad de pagina opnieuw en klaar. Modules halen wat ze nodig
//     hebben uit SETTINGS; de invoervelden op de pagina krijgen hun
//     min/max/stap ook van hier (zie applyInputLimits en de data-limits
//     attributen in index.html).
//
//     De eenheid staat in de naam: Mm = millimeter, Percent = procent. Een
//     bereik is { default, min, max, step }: `default` is de beginwaarde,
//     `min` en `max` zijn de grenzen van het veld of de schuifbalk, `step` is
//     de stapgrootte.
//
//     Bewust NIET hier: de interne geometrie-toleranties (bijvoorbeeld
//     GEOMETRY_TOLERANCE_MM en OVERLAP). Ze hangen van elkaar af, en een
//     verkeerde waarde laat de 3D-berekening mislukken in plaats van het
//     ontwerp te veranderen. Prijzen staan in src/orders/pricing.py.
//
//     Een foute waarde (min boven max, een default buiten het bereik, ...)
//     stopt de pagina bij het laden met een melding waarin de instelling
//     staat, zie validateSettings() onderaan dit bestand.

const definition = {
  // ==========================================================================
  // stamp — size and shape of the stamp itself / maten van de stempel zelf
  // ==========================================================================
  stamp: {
    // EN: Width of the stamp face (a round stamp is this wide, a square stamp
    //     is this wide and this long). `default` is the size of a new design;
    //     `min`/`max` limit the Face size field and slider. The finished
    //     stamp is also held to maxWidthMm and maxLengthMm below, so keep
    //     `max` at or under those.
    // NL: Breedte van het stempelvlak (een ronde stempel is zo breed, een
    //     vierkante stempel is zo breed en zo lang). `default` is de maat van
    //     een nieuw ontwerp; `min`/`max` begrenzen het veld en de schuifbalk
    //     voor de stempelgrootte. De klare stempel wordt ook begrensd door
    //     maxWidthMm en maxLengthMm hieronder: houd `max` daar op of onder.
    faceSizeMm: { default: 50, min: 10, max: 120, step: 1 },

    // EN: The largest stamp that can be made, measured over the finished
    //     plate: width along X, length along Y. This is what stops a stamp
    //     from growing without limit (the Minimal shape follows the artwork,
    //     so big artwork makes a big plate). A bigger stamp shows an error
    //     that names the size and the maximum, and it cannot be exported or
    //     ordered until the design is smaller. The server checks the same
    //     limit when an order arrives (MAX_STAMP_WIDTH_MM and
    //     MAX_STAMP_LENGTH_MM in src/orders/pricing.py): keep them equal, a
    //     test fails if they differ. Sizes are compared to 0.01 mm.
    // NL: De grootste stempel die gemaakt kan worden, gemeten over de klare
    //     plaat: breedte langs X, lengte langs Y. Dit voorkomt dat een stempel
    //     onbeperkt groeit (de vorm Minimal volgt het ontwerp, dus een groot
    //     ontwerp geeft een grote plaat). Een grotere stempel toont een
    //     foutmelding met de maat en het maximum, en kan niet worden
    //     geëxporteerd of besteld tot het ontwerp kleiner is. De server
    //     controleert dezelfde grens bij een bestelling (MAX_STAMP_WIDTH_MM en
    //     MAX_STAMP_LENGTH_MM in src/orders/pricing.py): houd ze gelijk, een
    //     test faalt als ze verschillen. Maten worden vergeleken op 0,01 mm.
    maxWidthMm: 200,
    maxLengthMm: 200,

    // EN: Thickness of the base plate, without the raised letters. Thicker is
    //     sturdier but uses more clay and print time; thinner can bend or
    //     crack. The total stamp height is this plus the relief depth plus
    //     the height of the handle.
    // NL: Dikte van de basisplaat, zonder de verhoogde letters. Dikker is
    //     steviger maar kost meer klei en printtijd; dunner kan buigen of
    //     breken. De totale hoogte van de stempel is deze waarde plus de
    //     reliëfdiepte plus de hoogte van het handvat.
    faceThicknessMm: { default: 4, min: 1, max: 20, step: 0.5 },

    // EN: How far the letters stand out of the plate (raised) or sink into it
    //     (recessed). Deeper gives a clearer print in clay but is harder to
    //     release. For a recessed stamp it must stay smaller than the base
    //     thickness (the page refuses it otherwise).
    // NL: Hoe ver de letters boven de plaat uitsteken (verhoogd) of erin
    //     zakken (verdiept). Dieper geeft een duidelijkere afdruk in klei maar
    //     laat moeilijker los. Bij een verdiepte stempel moet het kleiner
    //     blijven dan de basisdikte (de pagina weigert het anders).
    reliefDepthMm: { default: 2, min: 0.4, max: 8, step: 0.2 },

    // EN: Clear space between the artwork and the edge of the stamp (called
    //     "margin" in the code). `min` is the smallest distance allowed. Text
    //     or a logo that comes closer than this turns red and gets the
    //     overflow warning. Raise `min` for a roomier border.
    // NL: Vrije ruimte tussen het ontwerp en de rand van de stempel ("margin"
    //     in de code). `min` is de kleinste toegestane afstand. Tekst of een
    //     logo dat dichterbij komt wordt rood en krijgt de waarschuwing dat
    //     het te groot is. Verhoog `min` voor een ruimere rand.
    edgeDistanceMm: { default: 2, min: 2, max: 20, step: 0.5 },

    // EN: The edge distance may never be more than this share of the stamp
    //     size (0.25 = a quarter), so that enough room is left for the
    //     artwork on a small stamp.
    // NL: De randafstand mag nooit meer zijn dan dit deel van de
    //     stempelgrootte (0.25 = een kwart), zodat er op een kleine stempel
    //     genoeg ruimte overblijft voor het ontwerp.
    edgeDistanceMaxShareOfFace: 0.25,

    // EN: Rounds the edge all the way round the plate, so the plate does not
    //     leave a sharp cut in the clay and is pleasant to hold. These are the
    //     radii of the rounding (2 = a quarter circle with a radius of 2 mm),
    //     used when the customer has "Rounded edges" switched on (it starts
    //     on; see `roundedEdges` in `DEFAULT_STAMP`); 0 leaves that edge sharp.
    //     The larger the radius, the further from the edge the curve begins.
    //     The CLAY side is the side with the letters. It is the edge that meets
    //     the clay, so it gets the larger rounding; it prints without supports.
    //     The HANDLE side is the back of the plate. There the rounding is an
    //     overhang for the printer: the steepest layer step is about 54 degrees
    //     from vertical at 1 mm, 61 at 1.5 mm and 65 at 2 mm (0.2 mm layers),
    //     so above about 1 mm that side needs supports. Both must stay at or
    //     under the edge distance above, so that letters never sit on the curved
    //     part (the check at load enforces this). Together they are never taller
    //     than the base thickness (if they would be, both shrink in proportion).
    //     Keep each at 0.8 or more, or 0: with a 0.4 mm nozzle a smaller
    //     rounding is lost in printing.
    // NL: Rondt de rand helemaal rond de plaat af, zodat de plaat geen scherpe
    //     snede in de klei maakt en prettig vast te houden is. Dit zijn de
    //     stralen van de afronding (2 = een kwartcirkel met een straal van
    //     2 mm), gebruikt als de klant "Rounded edges" aan heeft staan (het
    //     begint aan; zie `roundedEdges` in `DEFAULT_STAMP`); 0 laat die rand
    //     scherp. Hoe groter de straal, hoe verder van de rand de bocht begint.
    //     De KLEIKANT is de kant met de letters. Dat is de rand die de klei
    //     raakt, dus die krijgt de grotere afronding; hij print zonder support.
    //     De HANDVATKANT is de achterkant van de plaat. Daar is de afronding een
    //     overhang voor de printer: de steilste laagstap is ongeveer 54 graden
    //     van verticaal bij 1 mm, 61 bij 1,5 mm en 65 bij 2 mm (lagen van
    //     0,2 mm), dus boven ongeveer 1 mm heeft die kant support nodig. Beide
    //     moeten op of onder de randafstand hierboven blijven, zodat letters
    //     nooit op het gebogen deel staan (de controle bij het laden dwingt dit
    //     af). Samen zijn ze nooit hoger dan de basisdikte (als ze dat wel
    //     zouden zijn, krimpen beide in verhouding). Houd elk op 0,8 of hoger,
    //     of op 0: met een 0,4 mm nozzle gaat een kleinere afronding verloren
    //     bij het printen.
    edgeRoundingClaySideMm: 2,
    edgeRoundingHandleSideMm: 1,

    // EN: The radius of the rounded corners of a Square or Minimal plate, seen
    //     from above, when the customer switches "Rounded corners" on (a Round
    //     plate has no corners). It must be above 0 and at most the edge
    //     distance, so that the usable area for artwork stays a plain square
    //     and artwork never gets close to a curved corner (the check at load
    //     enforces this). A small plate never gets a radius of more than about
    //     45% of its shortest side.
    // NL: De straal van de afgeronde hoeken van een vierkante of Minimal
    //     plaat, van boven gezien, als de klant "Rounded corners" aanzet (een
    //     ronde plaat heeft geen hoeken). Hij moet boven 0 zijn en hooguit de
    //     randafstand, zodat het bruikbare gebied voor het ontwerp een gewoon
    //     vierkant blijft en het ontwerp nooit dicht bij een gebogen hoek komt
    //     (de controle bij het laden dwingt dit af). Een kleine plaat krijgt
    //     nooit een straal van meer dan ongeveer 45% van de kortste zijde.
    cornerRadiusMm: 2,
  },

  // ==========================================================================
  // handle — the bar you hold on the back / de balk die je aan de achterkant vasthoudt
  // ==========================================================================
  handle: {
    // EN: Size of the handle (a long rectangular bar). Width runs along the
    //     stamp's width (X) and is the length you hold. Depth is the thickness
    //     along Y. Height is how far it hangs below the plate. A smaller face
    //     shrinks the whole bar; these numbers are the full size on a normal stamp.
    // NL: Maat van het handvat (een lange rechthoekige balk). De breedte loopt
    //     langs de breedte van de stempel (X) en is de lengte die je vasthoudt.
    //     De diepte is de dikte langs Y. De hoogte is hoe ver het onder de plaat
    //     hangt. Een kleiner vlak laat de hele balk krimpen; dit zijn de volle
    //     maten op een normale stempel.
    widthMm: 40,
    depthMm: 14,
    heightMm: 12,

    // EN: On a small stamp the handle shrinks (keeping its proportions) so
    //     that its longer side uses at most this share of the stamp's shorter
    //     side. 0.85 keeps the full 40 mm bar on a 50 mm face.
    // NL: Op een kleine stempel krimpt het handvat (met behoud van de
    //     verhoudingen) zodat de langste zijde hoogstens dit deel van de
    //     kortste zijde van de stempel gebruikt. 0,85 houdt de volle balk van
    //     40 mm op een vlak van 50 mm.
    maxShareOfFace: 0.85,
  },

  // ==========================================================================
  // checks — when the page shows a warning / wanneer de pagina waarschuwt
  // ==========================================================================
  checks: {
    // EN: The thin-details warning ("may be too thin to print"). Letters or
    //     shapes with a stroke thinner than this are flagged. It is an
    //     estimate. Raise it to get more warnings (stricter); lower it to get
    //     fewer (the stamp may then lose fine details when printed or pressed
    //     into clay).
    // NL: De waarschuwing voor dunne details ("kan te dun zijn om te
    //     printen"). Letters of vormen met een lijndikte onder deze waarde
    //     worden gemarkeerd. Het is een schatting. Verhoog de waarde voor meer
    //     waarschuwingen (strenger); verlaag hem voor minder (de stempel kan
    //     dan fijne details verliezen bij het printen of in de klei).
    thinFeatureMm: 0.8,

    // EN: The narrow-gap warning ("gap may close up"). Two parts of the
    //     artwork, or a hole, closer together than this are flagged, because
    //     the clay or the printer would fill the gap and join them. It is a
    //     provisional value (three lines of a 0.4 mm nozzle); a clay test of
    //     slots and holes can replace it. Raise it for stricter, lower it for
    //     fewer warnings. This is separate from thinFeatureMm, which is about
    //     the thickness of the lines themselves.
    // NL: De waarschuwing voor smalle spleten ("spleet kan dichtlopen"). Twee
    //     delen van het ontwerp, of een gat, die dichter bij elkaar zitten dan
    //     dit worden gemarkeerd, omdat de klei of de printer de spleet zou
    //     vullen en de delen zou verbinden. Het is een voorlopige waarde (drie
    //     lijnen van een 0,4 mm nozzle); een kleitest met sleuven en gaten kan
    //     hem vervangen. Verhoog hem voor strenger, verlaag hem voor minder
    //     waarschuwingen. Dit staat los van thinFeatureMm, dat over de dikte
    //     van de lijnen zelf gaat.
    clearGapMm: 1.2,
  },

  // ==========================================================================
  // text — text elements / tekstelementen
  // ==========================================================================
  text: {
    // EN: The most rows (lines) one text element may have. More rows gets a
    //     warning asking the customer to shorten the text.
    // NL: Het maximale aantal regels van één tekstelement. Meer regels geeft
    //     een waarschuwing dat de tekst korter moet.
    maxRows: 4,

    // EN: Text size of the first text in a design (and the fallback for
    //     texts without a size). This is the em size in millimetres, the same
    //     idea as the point size in Word (1 pt = 0.3528 mm).
    // NL: Tekstgrootte van de eerste tekst in een ontwerp (en de terugval
    //     voor teksten zonder grootte). Dit is de em-grootte in millimeter,
    //     hetzelfde idee als de puntgrootte in Word (1 pt = 0,3528 mm).
    defaultSizeMm: 16,

    // EN: Text size of a text added with the "Add Text" button. Smaller than
    //     the first text so it fits next to what is already on the stamp.
    // NL: Tekstgrootte van een tekst die met de knop "Add Text" wordt
    //     toegevoegd. Kleiner dan de eerste tekst zodat hij naast wat er al
    //     op de stempel staat past.
    newTextSizeMm: 7.5,

    // EN: Smallest and largest text size the slider and field accept. `step`
    //     is how the text size snaps when the customer resizes text by
    //     dragging the corner handles (0.5 = whole and half millimetres). A
    //     small `min` allows letters too thin to print; the thin-details
    //     warning (checks.thinFeatureMm) will say so.
    // NL: Kleinste en grootste tekstgrootte die de schuifbalk en het veld
    //     toestaan. `step` is hoe de tekstgrootte vastklikt als de klant tekst
    //     schaalt door aan de hoekpunten te slepen (0.5 = hele en halve
    //     millimeters). Een kleine `min` staat letters toe die te dun zijn om
    //     te printen; de waarschuwing voor dunne details
    //     (checks.thinFeatureMm) meldt dat dan.
    sizeMm: { min: 0.5, max: 60, step: 0.5 },

    // EN: Distance between the lines of a text, as a multiple of the text
    //     size (1.25 = 25% extra room between lines).
    // NL: Afstand tussen de regels van een tekst, als veelvoud van de
    //     tekstgrootte (1,25 = 25% extra ruimte tussen de regels).
    lineSpacing: { default: 1.25, min: 0.5, max: 3, step: 0.05 },

    // EN: Extra space between letters, in percent of the text size (negative
    //     = tighter). The starting value of a text is 0.
    // NL: Extra ruimte tussen letters, in procent van de tekstgrootte
    //     (negatief = dichter op elkaar). De beginwaarde van een tekst is 0.
    letterSpacingPercent: { min: -25, max: 150, step: 1 },

    // EN: Makes letter strokes thicker (+) or thinner (-) than the font
    //     draws them, in millimetres. 0 is the font as designed. Useful to
    //     rescue thin letters, but too much distorts the letter shapes.
    // NL: Maakt de lijnen van letters dikker (+) of dunner (-) dan het
    //     lettertype ze tekent, in millimeter. 0 is het lettertype zoals
    //     ontworpen. Handig om dunne letters te redden, maar te veel vervormt
    //     de letters.
    letterThicknessMm: { min: -0.6, max: 1.5, step: 0.1 },
  },

  // ==========================================================================
  // elements — moving and sizing elements / elementen verplaatsen en schalen
  // ==========================================================================
  elements: {
    // EN: How much an element (text, SVG, PNG) may be scaled. Used by the
    //     scale field and by dragging the corner handles. 1 = original size.
    // NL: Hoeveel een element (tekst, SVG, PNG) geschaald mag worden. Gebruikt
    //     door het schaalveld en door het slepen van de hoekpunten. 1 =
    //     oorspronkelijke grootte.
    scale: { default: 1, min: 0.05, max: 4, step: 0.05 },

    // EN: How far an element (text, SVG, PNG) may be made wider or narrower on
    //     its own, compared with its height. 1 = natural proportions, 2 = twice
    //     as wide as it is tall, 0.5 = half as wide. Used by the side handles
    //     and by the width and height fields when "Keep proportions" is off.
    // NL: Hoeveel breder of smaller een element (tekst, SVG, PNG) los van de
    //     hoogte gemaakt mag worden. 1 = natuurlijke verhoudingen, 2 = twee keer
    //     zo breed als hoog, 0,5 = half zo breed. Gebruikt door de zijhandvaten
    //     en door de velden breedte en hoogte als "Keep proportions" uit staat.
    stretch: { default: 1, min: 0.1, max: 10, step: 0.05 },

    // EN: Whether typing a width or a height in the element panel also changes
    //     the other one, so the proportions stay the same (true), or changes
    //     only the one you typed (false). The customer can switch it with the
    //     "Keep proportions" switch; this is what it starts as. Dragging a
    //     corner handle always keeps the proportions, dragging a side handle
    //     never does.
    // NL: Of het typen van een breedte of hoogte in het elementenpaneel ook de
    //     andere verandert, zodat de verhoudingen gelijk blijven (true), of
    //     alleen degene die je typt (false). De klant kan dit omzetten met de
    //     schakelaar "Keep proportions"; dit is de beginstand. Een hoekhandvat
    //     slepen behoudt altijd de verhoudingen, een zijhandvat slepen nooit.
    keepProportions: true,

    // EN: Size of a newly added SVG or PNG picture (its longest side, in
    //     millimetres) and the limits of the "Source size" field.
    // NL: Grootte van een nieuw toegevoegde SVG- of PNG-afbeelding (de
    //     langste zijde, in millimeter) en de grenzen van het veld
    //     "Source size".
    pictureSizeMm: { default: 30, min: 0.5, max: 120, step: 0.5 },

    // EN: How far an element moves per press of an arrow key.
    // NL: Hoeveel een element verschuift per druk op een pijltjestoets.
    keyboardMoveStepMm: 0.5,

    // EN: How far a duplicated element is shifted from the original, so you
    //     can see there are two.
    // NL: Hoeveel een gedupliceerd element wordt verschoven ten opzichte van
    //     het origineel, zodat je ziet dat er twee zijn.
    duplicateOffsetMm: 2,

    // EN: Gap between a newly added text and the artwork already on the
    //     stamp when the new text is placed in free space.
    // NL: Ruimte tussen een nieuw toegevoegde tekst en het ontwerp dat al op
    //     de stempel staat, als de nieuwe tekst op een vrije plek komt.
    newTextGapMm: 2,
  },

  // ==========================================================================
  // images — PNG pictures / PNG-afbeeldingen
  // ==========================================================================
  images: {
    png: {
      // EN: The largest PNG that is accepted, in pixels (width x height).
      //     4,000,000 is 4 megapixels. Bigger images take long to trace and
      //     are refused with a message. Raise it only if the browser copes.
      // NL: De grootste PNG die wordt geaccepteerd, in pixels (breedte x
      //     hoogte). 4.000.000 is 4 megapixel. Grotere afbeeldingen duren
      //     lang om over te trekken en worden met een melding geweigerd.
      //     Verhoog dit alleen als de browser het aankan.
      maxPixels: 4_000_000,

      // EN: How strongly the outline of a PNG is smoothed. Higher removes
      //     jagged edges but also loses fine detail; 0 keeps every pixel
      //     edge. `default` is the starting value for a new PNG.
      // NL: Hoe sterk de omtrek van een PNG wordt afgevlakt. Hoger haalt
      //     rafelige randen weg maar verliest ook fijn detail; 0 houdt elke
      //     pixelrand. `default` is de beginwaarde voor een nieuwe PNG.
      smoothing: { default: 2, min: 0, max: 4, step: 0.25 },

      // EN: Multiplier for how far a pixel's colour may differ from the
      //     background and still count as background (1 = normal). Lower
      //     keeps more of the picture, higher removes more of the background.
      // NL: Vermenigvuldiger voor hoe ver de kleur van een pixel van de
      //     achtergrond mag afwijken en toch als achtergrond telt (1 =
      //     normaal). Lager houdt meer van de afbeelding, hoger haalt meer van
      //     de achtergrond weg.
      backgroundTolerance: { default: 1, min: 0.5, max: 1.5, step: 0.05 },

      // EN: How far the traced outline may be simplified away from the
      //     picture's pixel edges, in millimetres. The real value follows the
      //     picture's resolution and the smoothing setting, but is kept
      //     between `min` and `max` (these are the values at the default
      //     smoothing; they scale with the smoothing strength). Smaller keeps
      //     more detail but gives more points, so a heavier and slower stamp.
      // NL: Hoe ver de overgetrokken omtrek mag worden vereenvoudigd ten
      //     opzichte van de pixelranden van de afbeelding, in millimeter. De
      //     echte waarde volgt de resolutie van de afbeelding en de
      //     afvlakking, maar blijft tussen `min` en `max` (dit zijn de
      //     waarden bij de standaard afvlakking; ze schalen mee met de
      //     afvlakkingssterkte). Kleiner houdt meer detail maar geeft meer
      //     punten, dus een zwaardere en tragere stempel.
      traceToleranceMm: { min: 0.05, max: 0.5 },
    },
  },

  // ==========================================================================
  // order — ordering / bestellen
  // ==========================================================================
  order: {
    // EN: The most stamps in one order. MUST be the same as MAX_QUANTITY in
    //     src/orders/pricing.py (the server checks it too); a test fails if
    //     they differ.
    // NL: Het maximale aantal stempels in één bestelling. MOET gelijk zijn
    //     aan MAX_QUANTITY in src/orders/pricing.py (de server controleert het
    //     ook); een test faalt als ze verschillen.
    maxQuantity: 999,
  },
};

// --------------------------------------------------------------------------
// Below this line there is nothing to tweak. / Onder deze regel valt niets
// aan te passen.
// --------------------------------------------------------------------------

/** Stops the page, naming the setting, when a value does not make sense. */
export function validateSettings(settings) {
  const problems = [];
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (typeof value === "boolean") {
        continue;
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) problems.push(`${here} must be a number`);
      } else if (value !== null && typeof value === "object") {
        const { min, max, step } = value;
        const default_ = value.default;
        if (min !== undefined && max !== undefined && min > max) {
          problems.push(`${here}: min (${min}) is above max (${max})`);
        }
        if (default_ !== undefined && min !== undefined && default_ < min) {
          problems.push(`${here}: default (${default_}) is below min (${min})`);
        }
        if (default_ !== undefined && max !== undefined && default_ > max) {
          problems.push(`${here}: default (${default_}) is above max (${max})`);
        }
        if (step !== undefined && !(step > 0)) {
          problems.push(`${here}: step (${step}) must be above 0`);
        }
        walk(value, here);
      } else {
        problems.push(`${here} must be a number, true or false, or a { default, min, max, step } range`);
      }
    }
  };
  walk(settings, "");

  const { stamp, handle, text, elements, order } = settings;
  const rule = (ok, message) => {
    if (!ok) problems.push(message);
  };
  rule(
    stamp.reliefDepthMm.default < stamp.faceThicknessMm.default,
    "stamp.reliefDepthMm.default must be smaller than stamp.faceThicknessMm.default",
  );
  rule(
    stamp.maxWidthMm > 0 && stamp.maxLengthMm > 0,
    "stamp.maxWidthMm and stamp.maxLengthMm must be above 0",
  );
  rule(
    stamp.faceSizeMm.max <= Math.min(stamp.maxWidthMm, stamp.maxLengthMm),
    "stamp.faceSizeMm.max must not be above stamp.maxWidthMm and stamp.maxLengthMm",
  );
  rule(
    stamp.faceSizeMm.min > 2 * stamp.edgeDistanceMm.min,
    "stamp.faceSizeMm.min must be more than twice stamp.edgeDistanceMm.min",
  );
  rule(
    stamp.edgeDistanceMaxShareOfFace > 0 && stamp.edgeDistanceMaxShareOfFace <= 0.5,
    "stamp.edgeDistanceMaxShareOfFace must be above 0 and at most 0.5",
  );
  for (const name of ["edgeRoundingClaySideMm", "edgeRoundingHandleSideMm"]) {
    rule(
      stamp[name] >= 0 && stamp[name] <= stamp.edgeDistanceMm.min,
      `stamp.${name} must be at least 0 and at most stamp.edgeDistanceMm.min`,
    );
  }
  rule(
    stamp.cornerRadiusMm > 0 && stamp.cornerRadiusMm <= stamp.edgeDistanceMm.min,
    "stamp.cornerRadiusMm must be above 0 and at most stamp.edgeDistanceMm.min",
  );
  rule(
    handle.widthMm > 0 && handle.depthMm > 0 && handle.heightMm > 0,
    "handle.widthMm, depthMm and heightMm must be above 0",
  );
  rule(
    handle.maxShareOfFace > 0 && handle.maxShareOfFace <= 1,
    "handle.maxShareOfFace must be above 0 and at most 1",
  );
  rule(settings.checks.thinFeatureMm > 0, "checks.thinFeatureMm must be above 0");
  rule(settings.checks.clearGapMm > 0, "checks.clearGapMm must be above 0");
  rule(
    Number.isInteger(text.maxRows) && text.maxRows >= 1,
    "text.maxRows must be a whole number of at least 1",
  );
  for (const name of ["defaultSizeMm", "newTextSizeMm"]) {
    rule(
      text[name] >= text.sizeMm.min && text[name] <= text.sizeMm.max,
      `text.${name} must be within text.sizeMm`,
    );
  }
  rule(
    elements.scale.default >= elements.scale.min &&
      elements.scale.default <= elements.scale.max,
    "elements.scale.default must be within its min and max",
  );
  rule(
    elements.stretch.min > 0 &&
      elements.stretch.default >= elements.stretch.min &&
      elements.stretch.default <= elements.stretch.max,
    "elements.stretch must have a min above 0 and a default within its min and max",
  );
  rule(
    typeof elements.keepProportions === "boolean",
    "elements.keepProportions must be true or false",
  );
  rule(
    Number.isInteger(order.maxQuantity) && order.maxQuantity >= 1,
    "order.maxQuantity must be a whole number of at least 1",
  );

  if (problems.length > 0) {
    throw new Error(
      `Invalid Clayster settings in settings.js:\n- ${problems.join("\n- ")}`,
    );
  }
  return settings;
}

function deepFreeze(node) {
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === "object") deepFreeze(value);
  }
  return Object.freeze(node);
}

export const SETTINGS = deepFreeze(validateSettings(definition));

/** The range for a dotted path such as "stamp.faceSizeMm", or undefined. */
export function limitsAt(path, settings = SETTINGS) {
  return path
    .split(".")
    .reduce((node, key) => (node === undefined ? node : node[key]), settings);
}

/**
 * Gives every element marked data-limits="stamp.faceSizeMm" the min, max and
 * step of that setting, so the page and the code can never disagree.
 */
export function applyInputLimits(root = document, settings = SETTINGS) {
  for (const input of root.querySelectorAll("[data-limits]")) {
    const path = input.getAttribute("data-limits");
    const range = limitsAt(path, settings);
    if (range === null || typeof range !== "object") {
      throw new Error(`data-limits="${path}" does not point to a settings range.`);
    }
    for (const key of ["min", "max", "step"]) {
      if (range[key] !== undefined) input.setAttribute(key, String(range[key]));
    }
  }
}
