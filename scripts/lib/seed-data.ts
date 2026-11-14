// Datos de demostración para `npm run db:seed`. Textos originales escritos para la demo:
// los excerpts sirven para que la búsqueda funcione sin red.

export const DEMO_PASSWORD = 'pincushion-demo';
export const DEMO_TIMEZONE = 'Europe/Madrid';

export type SeedFetch =
  | { status: 'succeeded' }
  | { status: 'failed'; code: string; attempts: number }
  | { status: 'retrying'; code: string; attempts: number; retryInMs: number }
  | { status: 'skipped' };

export interface SeedBookmark {
  url: string;
  /** Vacío = título de respaldo (el dominio), con title_source='fallback'. */
  title: string;
  titleSource: 'page' | 'user' | 'fallback';
  description: string;
  excerpt: string;
  collection?: string;
  tags: string[];
  favorite?: boolean;
  /** Antigüedad de creación en días (con horas para repartir en el día). */
  daysAgo: number;
  fetch?: SeedFetch;
  /** En la papelera desde hace N días. */
  trashedDaysAgo?: number;
}

export interface SeedUser {
  email: string;
  collections: string[];
  bookmarks: SeedBookmark[];
  /** Token de bookmarklet revocado hace N días (ninguno activo). */
  revokedTokenDaysAgo?: number;
}

const alice: SeedUser = {
  email: 'alice@example.com',
  collections: ['Lectura', 'Recetas', 'Herramientas', 'Viajes', 'Algún día'],
  revokedTokenDaysAgo: 10,
  bookmarks: [
    // ── Lectura ──────────────────────────────────────────────
    {
      url: 'https://paulgraham.com/greatwork.html',
      title: 'How to Do Great Work',
      titleSource: 'page',
      description: 'A long essay on choosing a field, following curiosity and sustaining effort over years.',
      excerpt:
        'The essay argues that great work tends to come from a mix of natural aptitude, deep interest and the willingness to keep going when progress is slow. ' +
        'It suggests picking problems that feel exciting rather than merely prestigious, working on them in long uninterrupted stretches, and paying attention to the gaps that experts dismiss. ' +
        'Curiosity is described as the engine: questions you cannot stop thinking about are a better guide than any career plan. ' +
        'It also warns against affectation and recommends staying honest about what you do not know yet.',
      collection: 'Lectura',
      tags: ['ensayo', 'productividad'],
      favorite: true,
      daysAgo: 168,
    },
    {
      url: 'https://es.wikipedia.org/wiki/Ley_de_Parkinson',
      title: 'Ley de Parkinson - Wikipedia, la enciclopedia libre',
      titleSource: 'page',
      description: 'El trabajo se expande hasta llenar el tiempo disponible para que se termine.',
      excerpt:
        'La ley de Parkinson es la observación de que el trabajo se dilata hasta ocupar todo el tiempo que se le asigna. ' +
        'Fue formulada con tono satírico por el historiador naval Cyril Northcote Parkinson en un artículo de 1955 sobre la burocracia británica, ' +
        'donde señalaba que el número de funcionarios crecía con independencia de la cantidad de trabajo real. ' +
        'Hoy se cita en gestión de proyectos para justificar plazos cortos y entregas parciales, y suele mencionarse junto a la ley de la trivialidad, ' +
        'según la cual las reuniones dedican más tiempo a los asuntos menores que a los importantes.',
      collection: 'Lectura',
      tags: ['productividad', 'ensayo'],
      daysAgo: 150,
    },
    {
      url: 'https://www.robinsloan.com/notes/home-cooked-app/',
      title: 'An app can be a home-cooked meal',
      titleSource: 'page',
      description: 'Writing small software for the people you love, with no plans to scale.',
      excerpt:
        'The author describes building a tiny messaging app used only by his family, and compares it to cooking dinner at home: ' +
        'nobody expects a home-cooked meal to become a restaurant chain. Freed from growth, analytics and onboarding funnels, ' +
        'the software can be simple, a little rough and perfectly suited to four people. ' +
        'The piece is an invitation to treat programming as a domestic craft, where the measure of success is whether the people at the table enjoy it.',
      collection: 'Lectura',
      tags: ['programación', 'ensayo'],
      favorite: true,
      daysAgo: 131,
    },
    {
      url: 'https://www.inkandswitch.com/local-first/',
      title: 'Local-first software: You own your data, in spite of the cloud',
      titleSource: 'page',
      description: 'Seven ideals for software that keeps data on your devices while still allowing collaboration.',
      excerpt:
        'The research essay proposes seven ideals for local-first software: no spinners, your work is not trapped on one device, the network is optional, ' +
        'seamless collaboration, the long now, security and privacy by default, and user control. ' +
        'It reviews existing approaches such as files, web apps, Dropbox-style sync and mobile backends, then explains how CRDTs can merge concurrent edits without a central server. ' +
        'The authors share prototypes and the practical problems they ran into, from performance to schema changes.',
      collection: 'Lectura',
      tags: ['programación', 'ensayo'],
      daysAgo: 97,
    },
    {
      url: 'https://es.wikipedia.org/wiki/Tsundoku',
      title: 'Tsundoku - Wikipedia, la enciclopedia libre',
      titleSource: 'page',
      description: 'La costumbre de comprar libros y dejarlos apilados sin leer.',
      excerpt:
        'Tsundoku es una palabra japonesa que describe el hábito de adquirir material de lectura y dejar que se acumule sin leerlo. ' +
        'Combina términos que aluden a apilar y a leer, y se usa con humor más que como reproche. ' +
        'El concepto se ha popularizado en blogs y redes sociales para hablar de las listas infinitas de pendientes, ' +
        'incluidas las pestañas abiertas y los artículos guardados para más tarde que nunca llegan a abrirse.',
      collection: 'Lectura',
      tags: ['ensayo', 'japón'],
      daysAgo: 64,
    },
    {
      url: 'https://www.nngroup.com/articles/ten-usability-heuristics/',
      title: '10 Usability Heuristics for User Interface Design',
      titleSource: 'page',
      description: 'Broad rules of thumb for interaction design, from visibility of system status to error prevention.',
      excerpt:
        'The ten heuristics are general principles rather than specific guidelines: visibility of system status, match between the system and the real world, ' +
        'user control and freedom, consistency and standards, error prevention, recognition rather than recall, flexibility and efficiency of use, ' +
        'aesthetic and minimalist design, helping users recognize and recover from errors, and help and documentation. ' +
        'Each one comes with examples and a short explanation of why it reduces the effort people need to complete a task.',
      collection: 'Lectura',
      tags: ['diseño', 'accesibilidad'],
      daysAgo: 41,
    },
    {
      url: 'https://es.wikipedia.org/wiki/Efecto_Zeigarnik',
      title: 'Efecto Zeigarnik - Wikipedia, la enciclopedia libre',
      titleSource: 'page',
      description: 'Recordamos mejor las tareas interrumpidas que las terminadas.',
      excerpt:
        'El efecto Zeigarnik describe la tendencia a recordar con más facilidad las tareas inacabadas o interrumpidas que las completadas. ' +
        'Lo estudió la psicóloga Bluma Zeigarnik en los años veinte, a partir de una observación sobre camareros que recordaban pedidos pendientes y los olvidaban al cobrarlos. ' +
        'Se cita en productividad para explicar por qué apuntar las tareas libera la mente y por qué dejar algo a medias puede ayudar a retomarlo al día siguiente.',
      collection: 'Lectura',
      tags: ['productividad'],
      daysAgo: 22,
      trashedDaysAgo: 3,
    },
    // ── Recetas ──────────────────────────────────────────────
    {
      url: 'https://www.directoalpaladar.com/recetas-de-panes/pan-de-masa-madre-hidratacion-75',
      title: 'Pan de masa madre al 75 % de hidratación',
      titleSource: 'page',
      description: 'Horarios, temperaturas y cómo saber cuándo está lista la masa.',
      excerpt:
        'Mezcla 500 g de harina de fuerza con 375 g de agua y deja reposar una hora en autólisis antes de añadir 100 g de masa madre activa y 10 g de sal. ' +
        'Durante las dos primeras horas haz cuatro series de pliegues cada media hora y deja que la masa crezca alrededor de un 50 %. ' +
        'Bolea, coloca en un banneton enharinado y deja una fermentación lenta en frío en la nevera entre 12 y 16 horas: ' +
        'así se desarrolla más sabor y la greña se abre mejor. Hornea en olla de hierro precalentada a 250 °C, 20 minutos con tapa y 25 sin ella.',
      collection: 'Recetas',
      tags: ['masa madre'],
      favorite: true,
      daysAgo: 120,
    },
    {
      url: 'https://www.seriouseats.com/vegan-ramen-recipe',
      title: 'Rich and Creamy Vegan Ramen',
      titleSource: 'page',
      description: 'A plant-based broth with soy milk, miso and roasted vegetables that rivals tonkotsu.',
      excerpt:
        'The broth starts with kombu and dried shiitake steeped in water, then gets body from unsweetened soy milk and a spoonful of white miso. ' +
        'Roasting onions, garlic and ginger until dark adds depth, while a tare of soy sauce, mirin and sesame paste seasons each bowl. ' +
        'Top the noodles with marinated tofu, blanched greens, corn and a drizzle of chili oil. ' +
        'The recipe explains how to emulsify the fat so the soup turns opaque and coats the noodles.',
      collection: 'Recetas',
      tags: ['vegetariano', 'japón'],
      daysAgo: 104,
    },
    {
      url: 'https://cookieandkate.com/best-lentil-soup-recipe/',
      title: 'Best Lentil Soup Recipe',
      titleSource: 'page',
      description: 'Hearty, budget-friendly lentil soup with greens and a squeeze of lemon.',
      excerpt:
        'Brown or green lentils simmer with onion, carrot, celery, garlic, cumin and curry powder in vegetable broth with crushed tomatoes. ' +
        'Blending a portion of the soup makes it creamy without adding dairy, and a handful of kale or spinach goes in at the end. ' +
        'Lemon juice brightens the flavors right before serving. The soup keeps well in the fridge for several days and freezes for months.',
      collection: 'Recetas',
      tags: ['vegetariano'],
      daysAgo: 88,
    },
    {
      url: 'https://www.directoalpaladar.com/recetas-vegetarianas/pisto-manchego-receta-tradicional',
      title: 'Pisto manchego, receta tradicional',
      titleSource: 'page',
      description: 'Verduras de verano pochadas sin prisa con tomate casero.',
      excerpt:
        'Corta en dados cebolla, pimiento verde, pimiento rojo y calabacín, y pocha cada verdura por separado en aceite de oliva a fuego suave para que conserve su textura. ' +
        'Mientras tanto, prepara una salsa de tomate natural con una pizca de azúcar para corregir la acidez. ' +
        'Junta todo en la sartén y deja que se cocine veinte minutos más. ' +
        'Se sirve templado, con un huevo frito encima o como relleno de empanadillas, y al día siguiente está todavía mejor.',
      collection: 'Recetas',
      tags: ['vegetariano'],
      daysAgo: 52,
    },
    {
      url: 'https://www.justonecookbook.com/onigiri-rice-balls/',
      title: 'Onigiri (Japanese Rice Balls)',
      titleSource: 'page',
      description: 'How to shape rice balls by hand and the classic fillings: salmon, umeboshi and tuna mayo.',
      excerpt:
        'Use freshly cooked short-grain Japanese rice and let it cool just enough to handle. Wet your hands, rub a little salt on your palms and press the rice gently into a triangle around the filling. ' +
        'Classic fillings include grilled salted salmon, pickled plum and tuna with mayonnaise. ' +
        'Wrap a strip of nori right before eating so it stays crisp, or keep the onigiri in plastic wrap for a packed lunch.',
      collection: 'Recetas',
      tags: ['japón'],
      daysAgo: 33,
    },
    {
      url: 'https://www.recetasderechupete.com/croquetas-de-jamon/',
      title: 'Croquetas de jamón cremosas',
      titleSource: 'page',
      description: 'La bechamel justa para que queden cremosas por dentro.',
      excerpt: '',
      collection: 'Recetas',
      tags: [],
      daysAgo: 0.02,
      fetch: { status: 'retrying', code: 'timeout', attempts: 1, retryInMs: 10 * 60_000 },
    },
    // ── Herramientas ─────────────────────────────────────────
    {
      url: 'https://sqlite.org/fts5.html',
      title: 'SQLite FTS5 Extension',
      titleSource: 'page',
      description: 'Full-text search virtual tables: syntax, tokenizers, ranking with bm25 and auxiliary functions.',
      excerpt:
        'FTS5 is an SQLite virtual table module that provides full-text search functionality. A table is created with CREATE VIRTUAL TABLE ... USING fts5 and queried with the MATCH operator. ' +
        'The query syntax supports phrases in double quotes, prefix queries with an asterisk, boolean operators and NEAR groups. ' +
        'Built-in tokenizers include unicode61, which can remove diacritics, ascii, porter and trigram. ' +
        'External content tables let the index point at rows stored elsewhere, kept in sync with triggers, and bm25() ranks the results.',
      collection: 'Herramientas',
      tags: ['sqlite', 'programación'],
      favorite: true,
      daysAgo: 142,
    },
    {
      url: 'https://htmx.org/docs/',
      title: '</> htmx ~ Documentation',
      titleSource: 'page',
      description: 'Attributes for AJAX, CSS transitions and server-sent events directly in HTML.',
      excerpt:
        'htmx gives access to AJAX, CSS transitions, WebSockets and server-sent events directly in HTML through attributes such as hx-get, hx-post, hx-target and hx-swap. ' +
        'The server answers with HTML fragments instead of JSON, and htmx swaps them into the page. ' +
        'The documentation covers triggers, request indicators, history support with hx-push-url, out-of-band swaps and security considerations, ' +
        'and recommends progressive enhancement so that forms keep working when JavaScript is disabled.',
      collection: 'Herramientas',
      tags: ['programación'],
      daysAgo: 77,
    },
    {
      url: 'https://developer.mozilla.org/es/docs/Web/CSS/CSS_grid_layout',
      title: 'Diseño de cuadrícula CSS - CSS | MDN',
      titleSource: 'page',
      description: 'Guías y referencia del módulo CSS Grid Layout.',
      excerpt:
        'El módulo de cuadrícula de CSS permite dividir una página en regiones principales y definir la relación entre ellas en tamaño, posición y capas. ' +
        'Un contenedor con display: grid define filas y columnas con grid-template-columns y grid-template-rows, y la unidad fr reparte el espacio libre. ' +
        'Las áreas con nombre facilitan reorganizar el diseño con media queries, y funciones como repeat, minmax y auto-fill crean rejillas adaptables sin cálculos manuales.',
      collection: 'Herramientas',
      tags: ['css'],
      daysAgo: 70,
    },
    {
      url: 'https://www.w3.org/WAI/WCAG22/quickref/',
      title: 'How to Meet WCAG (Quickref Reference)',
      titleSource: 'page',
      description: 'Filterable checklist of WCAG 2.2 success criteria and techniques.',
      excerpt:
        'This customizable quick reference lists every WCAG 2.2 requirement with its success criteria, sufficient techniques and common failures. ' +
        'Filters narrow the list by level A, AA or AAA, by technology and by tags such as keyboard, images or forms. ' +
        'New criteria in version 2.2 include focus not obscured, dragging movements, target size minimum and accessible authentication. ' +
        'Each item links to an understanding document that explains intent and benefits for people with disabilities.',
      collection: 'Herramientas',
      tags: ['accesibilidad'],
      daysAgo: 58,
    },
    {
      url: 'https://modernfontstacks.com/',
      title: 'Modern Font Stacks',
      titleSource: 'page',
      description: 'System font stack CSS organized by typeface classification.',
      excerpt:
        'A collection of font-family declarations that rely only on fonts already installed on each operating system, so pages render quickly without downloading web fonts. ' +
        'Stacks are grouped by classification: system UI, transitional, old style, humanist, geometric humanist, neo-grotesque, monospace slab, industrial, rounded and handwritten. ' +
        'Each one shows a preview of how the text looks on Windows, macOS, Android and Linux.',
      collection: 'Herramientas',
      tags: ['tipografía', 'css'],
      daysAgo: 27,
    },
    {
      url: 'https://www.notion.so/plantilla-presupuesto-viaje',
      title: '',
      titleSource: 'fallback',
      description: '',
      excerpt: '',
      collection: 'Herramientas',
      tags: [],
      daysAgo: 9,
      fetch: { status: 'failed', code: 'http_error', attempts: 1 },
    },
    {
      url: 'https://media.nngroup.com/media/articles/attachments/Heuristic_Summary1-compressed.pdf',
      title: 'Heurísticas de usabilidad (resumen en PDF)',
      titleSource: 'user',
      description: 'Póster de una página para imprimir.',
      excerpt: '',
      collection: 'Herramientas',
      tags: ['diseño'],
      daysAgo: 40,
      fetch: { status: 'skipped' },
    },
    // ── Viajes ───────────────────────────────────────────────
    {
      url: 'https://www.japan-guide.com/e/e2158.html',
      title: 'Kyoto Travel Guide',
      titleSource: 'page',
      description: 'Temples, gardens and traditional neighborhoods of the former imperial capital.',
      excerpt:
        'Kyoto served as the imperial capital for more than a thousand years and keeps hundreds of temples and shrines, including Kinkakuji, Kiyomizudera and the torii tunnels of Fushimi Inari. ' +
        'The guide suggests staying near Kyoto Station or downtown, buying a bus day pass and visiting popular sites early in the morning to avoid crowds. ' +
        'Gion and Higashiyama are best explored on foot in the evening, and Arashiyama makes an easy half-day trip by train.',
      collection: 'Viajes',
      tags: ['japón'],
      favorite: true,
      daysAgo: 160,
    },
    {
      url: 'https://www.visitportugal.com/es/destinos/porto-e-norte',
      title: 'Oporto y Norte | Visit Portugal',
      titleSource: 'page',
      description: 'Bodegas de vino de Oporto, el valle del Duero y ciudades históricas del norte.',
      excerpt:
        'La región de Oporto y Norte reúne la ciudad de Oporto, con su ribera declarada Patrimonio Mundial y las bodegas de Vila Nova de Gaia, ' +
        'el valle del Duero con sus viñedos en terrazas y pueblos como Guimarães y Braga. ' +
        'Se recomienda recorrer el Duero en tren o en barco, probar la francesinha y el vino verde, y reservar un día para el parque nacional de Peneda-Gerês.',
      collection: 'Viajes',
      tags: ['portugal'],
      daysAgo: 112,
    },
    {
      url: 'https://www.japan-guide.com/railpass/',
      title: 'Japan Rail Pass',
      titleSource: 'page',
      description: 'When the pass pays off, how to buy it and which trains it covers.',
      excerpt:
        'The Japan Rail Pass offers unlimited rides on most JR trains, including many shinkansen, for seven, fourteen or twenty-one consecutive days. ' +
        'After recent price increases it pays off mainly for itineraries with several long-distance trips, such as Tokyo, Kyoto, Hiroshima and back. ' +
        'The page compares the national pass with regional passes and explains how to reserve seats and which Nozomi and Mizuho trains require a supplement.',
      collection: 'Viajes',
      tags: ['japón'],
      daysAgo: 85,
    },
    {
      url: 'https://es.wikipedia.org/wiki/Camino_portugués',
      title: 'Camino portugués - Wikipedia, la enciclopedia libre',
      titleSource: 'page',
      description: 'La ruta jacobea que sube desde Lisboa y Oporto hasta Santiago de Compostela.',
      excerpt:
        'El Camino portugués es una de las rutas de peregrinación a Santiago de Compostela. Parte tradicionalmente de Lisboa, aunque la mayoría de los peregrinos empieza en Oporto o en Tui para completar los últimos cien kilómetros. ' +
        'Existe una variante por la costa que sigue el litoral atlántico. ' +
        'La señalización con flechas amarillas es constante y hay albergues públicos y privados en casi todas las etapas.',
      collection: 'Viajes',
      tags: ['portugal'],
      daysAgo: 46,
    },
    {
      url: 'https://www.skyscanner.es/vuelos-a/lis/vuelos-baratos-a-lisboa.html',
      title: 'Vuelos baratos a Lisboa',
      titleSource: 'page',
      description: 'Comparador de vuelos con calendario de precios.',
      excerpt:
        'Compara precios de aerolíneas y agencias para volar a Lisboa desde Madrid, Barcelona, Valencia y otras ciudades. ' +
        'El calendario muestra los días más baratos del mes y las alertas de precio avisan cuando una ruta baja. ' +
        'Los vuelos directos desde Madrid duran algo más de una hora y suelen salir más baratos entre semana.',
      collection: 'Viajes',
      tags: ['portugal'],
      daysAgo: 60,
      trashedDaysAgo: 31,
    },
    // ── Sin colección ────────────────────────────────────────
    {
      url: 'https://practicaltypography.com/',
      title: 'Butterick’s Practical Typography',
      titleSource: 'page',
      description: 'An online book about typography for writers, lawyers and anyone who works with text.',
      excerpt:
        'The book starts from the premise that typography is the visual component of the written word and that good typography serves the reader. ' +
        'Its summary of key rules recommends a point size between 10 and 12 for print, line spacing of 120 to 145 percent, a line length of 45 to 90 characters, ' +
        'and avoiding underlining, all caps for long passages and multiple spaces between sentences. ' +
        'Chapters cover font recommendations, page layout, résumés and research papers.',
      tags: ['tipografía', 'diseño'],
      daysAgo: 15,
    },
  ],
};

const bob: SeedUser = {
  email: 'bob@example.com',
  collections: ['Trabajo'],
  bookmarks: [
    {
      url: 'https://sqlite.org/fts5.html',
      title: 'SQLite FTS5 Extension',
      titleSource: 'page',
      description: 'Para evaluar la búsqueda del panel interno.',
      excerpt:
        'FTS5 provides full-text search through virtual tables queried with MATCH. Phrase queries, prefix queries and the bm25 ranking function ' +
        'are available out of the box, and external content tables avoid storing the text twice.',
      collection: 'Trabajo',
      tags: ['sqlite'],
      daysAgo: 70,
    },
    {
      url: 'https://kubernetes.io/docs/concepts/overview/',
      title: 'Overview | Kubernetes',
      titleSource: 'page',
      description: 'What Kubernetes is and what it is not.',
      excerpt:
        'Kubernetes is a portable, extensible platform for managing containerized workloads and services. It provides service discovery, load balancing, ' +
        'storage orchestration, automated rollouts and rollbacks, self-healing and secret management. ' +
        'The overview explains how deployment evolved from physical servers to virtual machines and containers, and clarifies that Kubernetes is not a traditional PaaS.',
      collection: 'Trabajo',
      tags: ['kubernetes'],
      daysAgo: 55,
    },
    {
      url: 'https://www.postgresql.org/docs/current/indexes.html',
      title: 'PostgreSQL Documentation: Indexes',
      titleSource: 'page',
      description: 'B-tree, hash, GiST, GIN and BRIN indexes, partial and expression indexes.',
      excerpt:
        'Indexes are a common way to enhance database performance by letting the server find rows much faster than it could without them. ' +
        'The chapter describes the available index types, multicolumn indexes, combining multiple indexes with bitmap scans, unique indexes, ' +
        'indexes on expressions, partial indexes and index-only scans, and explains how to examine index usage with EXPLAIN.',
      collection: 'Trabajo',
      tags: ['postgres'],
      daysAgo: 38,
    },
    {
      url: 'https://sre.google/sre-book/monitoring-distributed-systems/',
      title: 'Monitoring Distributed Systems',
      titleSource: 'page',
      description: 'The four golden signals: latency, traffic, errors and saturation.',
      excerpt:
        'The chapter defines monitoring vocabulary such as white-box and black-box monitoring, dashboards and alerts, and proposes four golden signals for user-facing systems: ' +
        'latency, traffic, errors and saturation. It recommends paging only on symptoms that require urgent human action and keeping alert rules simple and predictable.',
      collection: 'Trabajo',
      tags: ['observabilidad'],
      favorite: true,
      daysAgo: 21,
    },
    {
      url: 'https://www.atlassian.com/es/agile/scrum/standups',
      title: 'Reuniones diarias de scrum',
      titleSource: 'page',
      description: 'Cómo hacer que la reunión diaria dure quince minutos y sirva para algo.',
      excerpt:
        'La reunión diaria es un encuentro breve en el que el equipo sincroniza su trabajo y detecta bloqueos. ' +
        'La guía propone mantenerla en quince minutos, de pie si es presencial, centrada en el objetivo del sprint y no en un informe de estado para el jefe. ' +
        'Los problemas que necesitan discusión se apuntan y se tratan después con las personas implicadas.',
      tags: ['reuniones', 'productividad'],
      daysAgo: 12,
    },
    {
      url: 'https://www.bbcgoodfood.com/recipes/classic-lasagne',
      title: 'Classic lasagne recipe',
      titleSource: 'page',
      description: 'Beef ragù, béchamel and fresh pasta sheets layered and baked.',
      excerpt:
        'A slow-cooked ragù of minced beef, pancetta, onion, carrot, celery, tomatoes and red wine is layered with béchamel and lasagne sheets, ' +
        'finished with grated parmesan and baked until golden and bubbling. Let it rest for ten minutes before cutting so the layers hold together.',
      tags: ['cocina'],
      daysAgo: 4,
    },
  ],
};

const dana: SeedUser = { email: 'dana@example.com', collections: [], bookmarks: [] };

export const DEMO_USERS: readonly SeedUser[] = [alice, bob, dana];
