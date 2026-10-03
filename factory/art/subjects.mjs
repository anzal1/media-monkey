// The hero art subjects. Tags are what the planner matches a story against:
// the thing itself, what it stands for in a reel, and the everyday apps or
// moments it shows up in. kind: photo | object | document | screen.
// Photos are 4:3, everything else 1:1.

export const SUBJECTS = [
  // photos: things people take, send and share
  {
    slug: 'cat-photo', kind: 'photo', aspect: '4:3',
    tags: ['cat', 'pet', 'photo', 'image', 'whatsapp', 'share', 'upload', 'jpeg', 'compression', 'camera'],
    prompt: 'An illustrated snapshot of a ginger cat curled up asleep on a sunny windowsill next to a small potted plant.',
  },
  {
    slug: 'dog-photo', kind: 'photo', aspect: '4:3',
    tags: ['dog', 'pet', 'photo', 'image', 'share', 'instagram', 'feed', 'upload', 'camera'],
    prompt: 'An illustrated snapshot of a happy scruffy dog sitting in a park on green grass with its tongue out, a tree behind it.',
  },
  {
    slug: 'beach-selfie', kind: 'photo', aspect: '4:3',
    tags: ['selfie', 'beach', 'holiday', 'photo', 'image', 'friends', 'share', 'story', 'camera', 'face'],
    prompt: 'An illustrated holiday selfie of two friends smiling on a beach, sea and a few gentle waves behind them, simple faces, one holding the camera out of frame.',
  },
  {
    slug: 'mountain-photo', kind: 'photo', aspect: '4:3',
    tags: ['mountain', 'landscape', 'travel', 'photo', 'image', 'wallpaper', 'trip', 'nature', 'camera'],
    prompt: 'An illustrated landscape photo of layered mountains with a snowy peak, a pine forest and a small lake in the foreground.',
  },
  {
    slug: 'city-night', kind: 'photo', aspect: '4:3',
    tags: ['city', 'skyline', 'night', 'photo', 'image', 'lights', 'travel', 'urban', 'video'],
    prompt: 'An illustrated photo of a city skyline at night seen across a calm river: tower blocks drawn as dark charcoal and deep sage silhouettes, dotted with small warm ochre lit windows, a pale crescent moon in a deep charcoal sky, soft ochre reflections in the water. Full bleed, the night sky reaches every edge.',
  },
  // objects: things that get bought, sent, stored, played
  {
    slug: 'birthday-cake', kind: 'object', aspect: '1:1',
    tags: ['birthday', 'cake', 'party', 'celebration', 'reminder', 'calendar', 'gift', 'wish'],
    prompt: 'A two-tier birthday cake with drips of icing and three lit candles on a cake stand.',
  },
  {
    slug: 'concert-ticket', kind: 'document', aspect: '1:1',
    tags: ['ticket', 'concert', 'event', 'booking', 'queue', 'sold out', 'seat', 'music', 'barcode'],
    prompt: 'A paper concert ticket with a torn perforated stub, a small star and music note motif, and an abstract stripe pattern instead of a barcode.',
  },
  {
    slug: 'receipt', kind: 'document', aspect: '1:1',
    tags: ['receipt', 'bill', 'payment', 'shopping', 'checkout', 'order', 'invoice', 'transaction', 'ledger'],
    prompt: 'A long curling paper shop receipt with a zigzag torn bottom edge, rows of plain wavy lines in place of items and prices, one bold bar near the bottom for the total.',
  },
  {
    slug: 'credit-card', kind: 'object', aspect: '1:1',
    tags: ['card', 'credit card', 'payment', 'bank', 'tap', 'checkout', 'fraud', 'contactless', 'money'],
    prompt: 'A generic payment card lying at a slight angle, terracotta coloured, with a gold chip, a contactless wave symbol and a row of blank bars where the numbers would be. No bank name, no network logo.',
  },
  {
    slug: 'qr-code', kind: 'object', aspect: '1:1',
    tags: ['qr', 'upi', 'scan', 'payment', 'shop', 'pay', 'india', 'merchant', 'code'],
    prompt: 'A small shop counter stand card showing a large generic square QR code pattern in ink with three corner squares and a small scan frame icon above it.',
  },
  {
    slug: 'coin-stack', kind: 'object', aspect: '1:1',
    tags: ['coins', 'money', 'savings', 'balance', 'transfer', 'bank', 'interest', 'account', 'ledger'],
    prompt: 'Three neat stacks of plain gold coins of different heights with a couple of loose coins in front. Coins have plain rims and no symbols.',
  },
  {
    slug: 'game-inventory', kind: 'screen', aspect: '1:1',
    tags: ['game', 'inventory', 'coins', 'items', 'loot', 'player', 'save', 'multiplayer', 'gaming', 'trade'],
    prompt: 'A video game inventory grid card: a 4 by 3 grid of rounded slots holding a sword, a shield, a potion bottle, a pile of gold coins, a gem, a key and a scroll, a few slots empty.',
  },
  {
    slug: 'song-cover', kind: 'object', aspect: '1:1',
    tags: ['song', 'music', 'album', 'cover', 'spotify', 'streaming', 'playlist', 'audio', 'vinyl'],
    prompt: 'A square album cover art sleeve with a vinyl record sliding half out of it. The cover shows an abstract sun over waves.',
  },
  {
    slug: 'movie-poster', kind: 'document', aspect: '1:1',
    tags: ['movie', 'film', 'poster', 'netflix', 'streaming', 'cinema', 'video', 'recommendation', 'watch'],
    prompt: 'A portrait movie poster pinned flat, showing a lone figure in a long coat standing under a huge moon, blank bars at the bottom where credits would be.',
  },
  {
    slug: 'map-route', kind: 'screen', aspect: '1:1',
    tags: ['map', 'route', 'gps', 'location', 'pin', 'navigation', 'uber', 'delivery', 'eta', 'directions'],
    prompt: 'A simple map card: soft street blocks, a park patch, a dashed route line winding from a small dot to a big terracotta location pin.',
  },
  {
    slug: 'delivery-bag', kind: 'object', aspect: '1:1',
    tags: ['food', 'delivery', 'order', 'bag', 'swiggy', 'zomato', 'takeaway', 'restaurant', 'rider'],
    prompt: 'A brown paper takeaway food bag with folded handles, a steaming noodle box and a drink cup peeking out of the top. No logo on the bag.',
  },
  {
    slug: 'parcel-box', kind: 'object', aspect: '1:1',
    tags: ['parcel', 'package', 'box', 'shipping', 'order', 'amazon', 'delivery', 'warehouse', 'tracking'],
    prompt: 'A closed cardboard parcel box in clean isometric view, one strip of tan packing tape running straight across the top seam and down the front, a small blank white shipping label on the side with two plain lines on it.',
  },
  {
    slug: 'passport', kind: 'document', aspect: '1:1',
    tags: ['passport', 'identity', 'id', 'travel', 'verification', 'kyc', 'login', 'auth', 'document'],
    prompt: 'An open illustrative passport-like booklet: left page has a simple portrait silhouette box, right page has plain wavy lines and two round abstract stamp shapes. No emblem, no country, no real document design.',
  },
  {
    slug: 'calendar-invite', kind: 'screen', aspect: '1:1',
    tags: ['calendar', 'invite', 'meeting', 'event', 'schedule', 'time', 'reminder', 'timezone', 'sync'],
    prompt: 'A calendar card showing a month grid of small squares with one square highlighted terracotta and a small clock icon beside it, plain bars in place of all text.',
  },
  {
    slug: 'document-page', kind: 'document', aspect: '1:1',
    tags: ['document', 'page', 'file', 'docs', 'pdf', 'edit', 'collaboration', 'text', 'save'],
    prompt: 'A single sheet of paper with a folded top corner, a heading bar, paragraphs drawn as plain wavy lines and a small image placeholder box.',
  },
  {
    slug: 'spreadsheet', kind: 'screen', aspect: '1:1',
    tags: ['spreadsheet', 'table', 'rows', 'columns', 'database', 'excel', 'data', 'sql', 'records'],
    prompt: 'A spreadsheet card: a grid of cells with a sage header row, a few cells filled with small bar shapes instead of numbers, one cell outlined in terracotta as selected.',
  },
  {
    slug: 'chat-sticker', kind: 'object', aspect: '1:1',
    tags: ['sticker', 'chat', 'emoji', 'message', 'whatsapp', 'reaction', 'fun', 'send', 'meme'],
    prompt: 'A die-cut chat sticker of a cheerful round cartoon cat face giving a thumbs up, with a thick white sticker border and a slightly curled peeling corner.',
  },
  {
    slug: 'fitness-ring', kind: 'screen', aspect: '1:1',
    tags: ['fitness', 'health', 'watch', 'steps', 'rings', 'sensor', 'wearable', 'activity', 'heart'],
    prompt: 'A round smartwatch style face showing three concentric activity rings in terracotta, sage and ochre, each partly filled, a small heart icon in the centre.',
  },
  {
    slug: 'weather-card', kind: 'screen', aspect: '1:1',
    tags: ['weather', 'forecast', 'rain', 'sun', 'cloud', 'widget', 'app', 'prediction', 'temperature'],
    prompt: 'A weather widget card: a sun partly behind a cloud with a few rain drops, and a row of five tiny forecast icons below it.',
  },
  {
    slug: 'boarding-pass', kind: 'document', aspect: '1:1',
    tags: ['flight', 'boarding pass', 'plane', 'travel', 'airport', 'ticket', 'booking', 'seat', 'checkin'],
    prompt: 'A generic airline boarding pass with a tear-off stub, a small plane silhouette, a dashed flight path line between two dots, and plain bars instead of text. No airline name.',
  },
  {
    slug: 'shopping-cart', kind: 'object', aspect: '1:1',
    tags: ['cart', 'shopping', 'checkout', 'ecommerce', 'order', 'sale', 'basket', 'stock', 'buy'],
    prompt: 'A small shopping trolley filled with a few groceries: a loaf of bread, a bottle, some apples and a box.',
  },
  {
    slug: 'lock-key', kind: 'object', aspect: '1:1',
    tags: ['lock', 'key', 'security', 'encryption', 'password', 'auth', 'secret', 'privacy', 'https'],
    prompt: 'A chunky closed padlock with an old fashioned key lying in front of it.',
  },
  {
    slug: 'plant', kind: 'object', aspect: '1:1',
    tags: ['plant', 'growth', 'home', 'nature', 'sensor', 'watering', 'calm', 'garden'],
    prompt: 'A leafy monstera plant in a terracotta pot.',
  },
  {
    slug: 'coffee-cup', kind: 'object', aspect: '1:1',
    tags: ['coffee', 'cafe', 'morning', 'order', 'queue', 'barista', 'cup', 'break', 'drink'],
    prompt: 'A takeaway coffee cup with a lid and a plain cardboard sleeve, a little curl of steam rising. No logo.',
  },
  {
    slug: 'handwritten-note', kind: 'document', aspect: '1:1',
    tags: ['note', 'handwriting', 'letter', 'message', 'paper', 'reminder', 'ocr', 'memo', 'sticky'],
    prompt: 'A small square sticky note stuck slightly crooked, covered in loose handwritten scribble lines that are clearly not readable letters, with a tiny doodled heart.',
  },
];
