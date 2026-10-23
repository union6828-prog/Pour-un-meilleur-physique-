'use strict';
/* ==========================================================================
   BodyTransformation AI — version navigateur (index.html + style.css + script.js)
   Fonctionne sans serveur : les données sont enregistrées dans ce navigateur
   (localStorage). Voir les notes "LIMITES" dans l'application et dans la
   réponse de livraison : paiements réels, e-mails, webhooks, rôles admin et
   IA conversationnelle nécessitent un serveur.
   ========================================================================== */

/* ---------- Configuration (modifiable) ---------- */
const CONFIG = {
  appName: 'BodyTransformation AI',
  contactEmail: 'contact@exemple.com',          // à remplacer par votre adresse
  plans: {
    free:  { name: 'Free',  monthly: 0,    ai: 3 },
    pro:   { name: 'Pro',   monthly: 4900, ai: 30 },
    elite: { name: 'Elite', monthly: 9900, ai: 100 }
  },
  annualDiscount: 0.2,                           // 20 % de réduction annuelle
  // Montants exprimés en FCFA (XOF). EUR : parité fixe. USD : taux indicatif à ajuster.
  rates: { XOF: 1, EUR: 1 / 655.957, USD: 1 / 600 },
  checkoutEndpoint: '',  // URL de VOTRE serveur qui crée la commande (CinetPay/Paystack) et renvoie { url }
  statusEndpoint: ''     // URL de VOTRE serveur qui renvoie { plan, until } après webhook vérifié
};

/* ---------- Traductions (FR complet, EN partiel — architecture prête) ---------- */
const I = {
  fr: {
    home: 'Accueil', features: 'Fonctionnalités', programs: 'Programmes', pricing: 'Tarifs', faq: 'FAQ',
    login: 'Connexion', signup: 'Inscription', logout: 'Déconnexion', dashboard: 'Tableau de bord',
    program: 'Programme', nutrition: 'Nutrition', progress: 'Suivi', coach: 'Coach IA',
    notifications: 'Notifications', subscription: 'Abonnement', settings: 'Paramètres',
    heroTitle: 'Transforme ton physique. Construis ta discipline.',
    heroSub: 'Un coach sportif intelligent : programmes personnalisés, nutrition adaptée à ton budget et suivi de tes progrès.',
    createProgram: 'Créer mon programme', seePricing: 'Voir les tarifs'
  },
  en: {
    home: 'Home', features: 'Features', programs: 'Programs', pricing: 'Pricing', faq: 'FAQ',
    login: 'Log in', signup: 'Sign up', logout: 'Log out', dashboard: 'Dashboard',
    program: 'Program', nutrition: 'Nutrition', progress: 'Progress', coach: 'AI Coach',
    notifications: 'Notifications', subscription: 'Subscription', settings: 'Settings',
    heroTitle: 'Transform your body. Build your discipline.',
    heroSub: 'A smart fitness coach: personalised programs, budget-friendly nutrition and progress tracking.',
    createProgram: 'Create my program', seePricing: 'See pricing'
  }
};
const lang = () => (DB && DB.lang) || 'fr';
const t = k => (I[lang()] && I[lang()][k]) || I.fr[k] || k;

/* ---------- Utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = n => String(n).padStart(2, '0');
const isoDay = d => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dowIdx = d => ((d || new Date()).getDay() + 6) % 7;            // lundi = 0
const DOW = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const fmtDate = s => { try { return new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const mmss = ms => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60); };
function weekStart(d) { const x = new Date(d || new Date()); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - dowIdx(x)); return x; }
let toastTimer;
function toast(msg, bad) {
  const el = $('#toast'); el.textContent = msg; el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 3200);
}

/* ---------- Stockage ---------- */
const KEY = 'bt_v1';
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.users) return d; } catch (e) { }
  return { users: {}, session: null, attempts: {}, lang: 'fr' };
}
let DB = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); return true; }
  catch (e) { toast('Stockage du navigateur plein : supprimez des photos ou exportez vos données.', true); return false; }
}
const me = () => DB.session ? DB.users[DB.session] : null;
const U = () => me().data;
function newData() {
  return {
    profile: null, program: null, sessions: [], measures: [], photos: [], foodLog: [], menu: null,
    notifs: [], active: null, plan: 'free', planUntil: null, transactions: [], ai: { date: '', count: 0 }, chat: [],
    settings: {
      currency: 'XOF', aiEndpoint: '',
      notif: { reminders: true, remindTime: '18:00', weekly: true, review: true, renewal: true, payfail: true, marketing: false }
    }
  };
}
function notify(type, text) {
  const d = U(); const n = d.settings.notif;
  if (type === 'marketing' && !n.marketing) return;
  if (type !== 'system' && n[type] === false) return;
  d.notifs.unshift({ id: uid(), type, text, date: new Date().toISOString(), read: false });
  d.notifs = d.notifs.slice(0, 60); save();
}

/* ---------- Authentification (locale au navigateur) ---------- */
async function hashPw(pw, salt) {
  if (!window.crypto || !crypto.subtle) throw new Error('Contexte non sécurisé : ouvrez l\'application en HTTPS ou sur localhost.');
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, k, 256);
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const rndSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* ---------- Abonnements ---------- */
const RANK = { free: 0, pro: 1, elite: 2 };
function plan() {
  const d = U();
  if (d.planUntil && Date.now() > d.planUntil && d.plan !== 'free') {
    d.plan = 'free'; d.planUntil = null; save();
    notify('renewal', 'Votre abonnement a expiré. Vous êtes revenu à la formule Free.');
  }
  return d.plan;
}
const can = min => RANK[plan()] >= RANK[min];
const lock = min => `<div class="notice warn">🔒 Fonction réservée à la formule <b>${CONFIG.plans[min].name}</b> (vérification dans le navigateur ; un serveur est nécessaire pour une vraie protection). <a href="#/subscription">Voir les formules</a></div>`;
function money(xof, cur) {
  cur = cur || (me() ? U().settings.currency : 'XOF');
  if (cur === 'XOF') return Math.round(xof).toLocaleString('fr-FR') + ' FCFA';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(xof * CONFIG.rates[cur]);
}
const priceOf = (pk, period) => {
  const m = CONFIG.plans[pk].monthly;
  return period === 'year' ? Math.round(m * 12 * (1 - CONFIG.annualDiscount) / 100) * 100 : m;
};

/* ---------- Bibliothèque d'exercices ---------- */
const ex = (id, name, muscle, level, equip, desc, safety, variants, flags) => ({ id, name, muscle, level, equip, desc, safety, variants, time: /t/.test(flags || ''), impact: /i/.test(flags || '') });
const EX = [
  ex('pompes', 'Pompes', 'pectoraux', 1, 'none', 'Mains sous les épaules, corps aligné, poitrine vers le sol puis poussée.', 'Ne creusez pas le dos, gardez le ventre gainé.', 'Sur genoux (plus facile), mains surélevées, pompes lestées (plus dur).'),
  ex('pompes-genoux', 'Pompes sur genoux', 'pectoraux', 1, 'none', 'Version allégée des pompes, genoux au sol.', 'Gardez le bassin aligné avec les épaules.', 'Mains sur un banc pour réduire encore la charge.'),
  ex('pike', 'Pompes en pique', 'epaules', 2, 'none', 'Bassin haut en V inversé, flexion des bras tête vers le sol.', 'Progressez doucement ; arrêtez en cas de douleur à l\'épaule.', 'Pieds surélevés pour plus de difficulté.'),
  ex('dips', 'Dips sur chaise', 'bras', 2, 'none', 'Mains sur une chaise stable, descendez en fléchissant les coudes.', 'Chaise stable, coudes vers l\'arrière, amplitude modérée.', 'Jambes fléchies (facile), jambes tendues (difficile).'),
  ex('squat', 'Squats', 'jambes', 1, 'none', 'Pieds largeur d\'épaules, descendez en poussant les hanches vers l\'arrière.', 'Genoux dans l\'axe des pieds, dos droit.', 'Squat sur chaise (facile), squat pause (difficile).'),
  ex('fentes', 'Fentes alternées', 'jambes', 1, 'none', 'Grand pas en avant, genou arrière vers le sol, poussez pour revenir.', 'Genou avant au-dessus de la cheville.', 'Fentes arrière (plus douces pour les genoux).'),
  ex('bulgare', 'Squats bulgares', 'jambes', 2, 'none', 'Pied arrière surélevé sur une chaise, descendez sur la jambe avant.', 'Appui stable, buste légèrement penché.', 'Sans surélévation (facile), avec haltères (difficile).'),
  ex('squat-saute', 'Squats sautés', 'jambes', 2, 'none', 'Squat suivi d\'un saut explosif, réception souple.', 'Réception silencieuse, genoux fléchis. Éviter en cas de douleur articulaire.', 'Squat avec montée sur pointes (sans impact).', 'i'),
  ex('pont', 'Pont fessier', 'fessiers', 1, 'none', 'Allongé, pieds au sol, poussez les hanches vers le plafond.', 'Ne cambrez pas excessivement le bas du dos.', 'Pont unilatéral (difficile).'),
  ex('pont-uni', 'Pont fessier unilatéral', 'fessiers', 2, 'none', 'Un pied au sol, l\'autre jambe tendue, poussez les hanches.', 'Bassin stable, mouvement lent.', 'Pont à deux jambes (facile).'),
  ex('donkey', 'Donkey kicks', 'fessiers', 1, 'none', 'À quatre pattes, poussez un talon vers le plafond.', 'Gardez le dos plat, sans cambrer.', 'Avec élastique ou lest de cheville.'),
  ex('mollets', 'Élévations de mollets', 'mollets', 1, 'none', 'Debout, montez sur la pointe des pieds et redescendez lentement.', 'Appuyez-vous à un mur si besoin.', 'À une jambe (difficile).'),
  ex('superman', 'Superman', 'dos', 1, 'none', 'Allongé sur le ventre, soulevez bras et jambes en même temps.', 'Mouvement lent, regard vers le sol.', 'Bras et jambes alternés (facile).'),
  ex('rowing-table', 'Rowing inversé sous table', 'dos', 2, 'none', 'Sous une table solide, tirez la poitrine vers le plateau.', 'N\'utilisez qu\'une table très stable et rigide.', 'Genoux fléchis (facile).'),
  ex('planche', 'Gainage planche', 'abdos', 1, 'none', 'Sur les avant-bras, corps aligné de la tête aux pieds.', 'Ne laissez pas le bassin s\'affaisser.', 'Sur genoux (facile), planche avec levée de jambe (difficile).', 't'),
  ex('crunch', 'Crunchs', 'abdos', 1, 'none', 'Allongé, genoux fléchis, soulevez légèrement les épaules.', 'Ne tirez pas sur la nuque.', 'Crunch inversé (jambes vers la poitrine).'),
  ex('releves', 'Relevés de jambes', 'abdos', 2, 'none', 'Allongé, montez les jambes tendues puis redescendez lentement.', 'Gardez le bas du dos au sol ; fléchissez les genoux si gêne.', 'Genoux fléchis (facile).'),
  ex('lateral', 'Gainage latéral', 'abdos', 2, 'none', 'Sur le côté, appui sur l\'avant-bras, corps aligné.', 'Hanches hautes, respiration régulière.', 'Genou au sol (facile).', 't'),
  ex('mountain', 'Mountain climbers', 'cardio', 2, 'none', 'En appui sur les mains, ramenez les genoux vers la poitrine en alternance.', 'Dos plat, rythme maîtrisé.', 'Version lente sans impact.', 'ti'),
  ex('jacks', 'Jumping jacks', 'cardio', 1, 'none', 'Sauts écartant bras et jambes en rythme.', 'Réception souple. Éviter en cas de douleur articulaire.', 'Version sans saut (pas chassés).', 'ti'),
  ex('burpees', 'Burpees', 'cardio', 3, 'none', 'Squat, appui au sol, pompe facultative, saut.', 'Exercice intense : progressez graduellement.', 'Sans saut ni pompe (facile).', 'i'),
  ex('haltere-dev', 'Développé haltères', 'pectoraux', 2, 'dumbbell', 'Allongé, poussez les haltères au-dessus de la poitrine.', 'Poids adapté, contrôle de la descente.', 'Au sol si pas de banc.'),
  ex('haltere-row', 'Rowing haltère', 'dos', 1, 'dumbbell', 'Un genou et une main sur un support, tirez l\'haltère vers la hanche.', 'Dos plat, ne tournez pas le buste.', 'Rowing à deux haltères penché.'),
  ex('haltere-epaules', 'Développé épaules haltères', 'epaules', 1, 'dumbbell', 'Assis ou debout, poussez les haltères au-dessus de la tête.', 'Ne cambrez pas, gainez le ventre.', 'Développé alterné.'),
  ex('curl', 'Curl biceps', 'bras', 1, 'dumbbell', 'Fléchissez les coudes en gardant les bras le long du corps.', 'Sans balancer le buste.', 'Curl marteau.'),
  ex('triceps', 'Extension triceps', 'bras', 1, 'dumbbell', 'Haltère derrière la tête, tendez les bras.', 'Coudes proches de la tête, charge modérée.', 'Kickback triceps.'),
  ex('goblet', 'Squat goblet', 'jambes', 1, 'dumbbell', 'Haltère contre la poitrine, squat profond contrôlé.', 'Dos droit, talons au sol.', 'Squat au poids du corps.'),
  ex('rdl', 'Soulevé de terre roumain haltères', 'fessiers', 2, 'dumbbell', 'Jambes quasi tendues, descendez les haltères le long des cuisses.', 'Dos plat, hanches vers l\'arrière.', 'Version à une jambe (difficile).'),
  ex('fentes-halt', 'Fentes avec haltères', 'jambes', 2, 'dumbbell', 'Fentes avec un haltère dans chaque main.', 'Charge modérée, équilibre stable.', 'Fentes marchées.'),
  ex('hipthrust-h', 'Hip thrust avec haltère', 'fessiers', 2, 'dumbbell', 'Dos sur un banc, haltère sur les hanches, poussez vers le haut.', 'Menton rentré, ne cambrez pas.', 'Pont fessier lesté au sol.'),
  ex('lateral-halt', 'Élévations latérales', 'epaules', 1, 'dumbbell', 'Levez les bras sur les côtés jusqu\'à l\'horizontale.', 'Charge légère, sans élan.', 'Une main à la fois.'),
  ex('developpe-couche', 'Développé couché (barre)', 'pectoraux', 2, 'gym', 'Barre sur banc, descendez à la poitrine puis poussez.', 'Utilisez un partenaire ou des sécurités.', 'Développé machine (plus guidé).'),
  ex('tirage-vertical', 'Tirage vertical', 'dos', 1, 'gym', 'Tirez la barre vers le haut de la poitrine.', 'Ne tirez pas derrière la nuque.', 'Tirage prise neutre.'),
  ex('tirage-basse', 'Tirage poulie basse', 'dos', 1, 'gym', 'Assis, tirez la poignée vers le ventre.', 'Dos droit, épaules basses.', 'Rowing machine.'),
  ex('presse', 'Presse à cuisses', 'jambes', 1, 'gym', 'Poussez la plateforme sans verrouiller les genoux.', 'Ne décollez pas le bassin du siège.', 'Pieds hauts pour cibler les fessiers.'),
  ex('leg-curl', 'Leg curl', 'jambes', 1, 'gym', 'Fléchissez les jambes contre la résistance.', 'Mouvement contrôlé, charge modérée.', 'Leg curl assis.'),
  ex('squat-barre', 'Squat avec barre', 'jambes', 3, 'gym', 'Barre sur les trapèzes, squat contrôlé.', 'Technique avant charge ; utilisez des sécurités.', 'Squat à la presse ou goblet.'),
  ex('sdt', 'Soulevé de terre', 'dos', 3, 'gym', 'Barre au sol, redressez-vous en gardant le dos plat.', 'Apprenez la technique avec une charge légère.', 'Soulevé roumain (plus léger).'),
  ex('hipthrust-b', 'Hip thrust à la barre', 'fessiers', 2, 'gym', 'Dos sur un banc, barre sur les hanches, poussez.', 'Protégez les hanches avec un coussin.', 'Hip thrust haltère.'),
  ex('crunch-poulie', 'Crunch à la poulie', 'abdos', 2, 'gym', 'À genoux, enroulez le buste vers le bas.', 'Mouvement des abdos, pas des bras.', 'Crunch au sol.'),
  ex('velo', 'Vélo (cardio)', 'cardio', 1, 'gym', 'Pédalage à intensité modérée.', 'Réglez la selle ; hydratez-vous.', 'Intervalles courts.', 't'),
  ex('tapis', 'Marche inclinée (tapis)', 'cardio', 1, 'gym', 'Marche rapide sur tapis incliné.', 'Ne vous tenez pas à la barre en continu.', 'Alternance marche/course.', 't'),
  ex('marche', 'Marche rapide', 'cardio', 1, 'outdoor', 'Marche à allure soutenue en extérieur.', 'Chaussures adaptées, hydratation.', 'Intervalles rapides/lents.', 't'),
  ex('course', 'Course légère', 'cardio', 1, 'outdoor', 'Footing à allure où vous pouvez parler.', 'Progressez par paliers, évitez la chaleur extrême.', 'Alternance marche/course.', 'ti'),
  ex('marches', 'Montées de marches', 'jambes', 2, 'outdoor', 'Montez des marches ou un banc stable en alternance.', 'Surface stable, descente contrôlée.', 'Marche simple (facile).')
];
const EXMAP = Object.fromEntries(EX.map(e => [e.id, e]));
const ENV = {
  home_none: { label: 'Maison sans matériel', equip: ['none'] },
  home_eq: { label: 'Maison équipée (haltères…)', equip: ['none', 'dumbbell'] },
  gym: { label: 'Salle de sport', equip: ['none', 'dumbbell', 'gym'] },
  outdoor: { label: 'Extérieur', equip: ['none', 'outdoor'] }
};
const GOALS = {
  fat: 'Perte de graisse', muscle: 'Prise de muscle', fitness: 'Condition physique', strength: 'Force', maintain: 'Entretien'
};
const LEVELS = { debutant: 1, intermediaire: 2, avance: 3 };
const WARMUP = ['5 min de marche ou de pas chassés', 'Rotations des épaules, hanches et chevilles (10 chacune)', '1 série légère du premier exercice'];
const COOLDOWN = ['3 min de marche lente', 'Étirements doux des muscles travaillés (20-30 s)', 'Respiration lente et hydratation'];
const IMPACT_WORDS = /genou|dos|articul|cheville|hanche|[eé]paule|tendin|hernie|op[eé]r/i;

/* ---------- Génération du programme ---------- */
function generateProgram(p) {
  const free = !can('pro');
  let days = (p.days || []).map(Number).sort((a, b) => a - b);
  if (free) days = days.slice(0, 3);
  const lvl = LEVELS[p.level] || 1;
  const allowed = ENV[p.env].equip;
  const avoid = norm(p.avoid || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const noImpact = !!(p.limits && p.limits.trim());
  const pool = EX.filter(e => allowed.includes(e.equip) && e.level <= lvl && !(noImpact && e.impact) && !avoid.some(a => norm(e.name).includes(a)));
  const FULL = ['jambes', 'pectoraux', 'dos', 'epaules', 'fessiers', 'abdos'];
  const UPPER = ['pectoraux', 'dos', 'epaules', 'bras', 'abdos'];
  const LOWER = ['jambes', 'fessiers', 'jambes', 'mollets', 'abdos'];
  const n = days.length || 1;
  const cycle = n <= 3 ? [FULL, FULL, FULL] : n === 4 ? [UPPER, LOWER, UPPER, LOWER] : [UPPER, LOWER, FULL, UPPER, LOWER, FULL];
  const count = clamp(Math.round((p.duration - 10) / 8), 3, 7);
  const maxEx = free ? Math.min(count, 4) : count;
  const scheme = {
    fat: { sets: 3, reps: '12-15', rest: 45 }, muscle: { sets: 4, reps: '8-12', rest: 75 },
    strength: { sets: 5, reps: '6-8', rest: 120 }, fitness: { sets: 3, reps: '10-12', rest: 60 }, maintain: { sets: 3, reps: '10', rest: 60 }
  }[p.goal];
  const used = {};
  const dayPlans = days.map((dow, i) => {
    const focus = cycle[i % cycle.length].slice();
    (p.focus || []).forEach(z => { if (maxEx > 3) focus.push(z === 'jambes' ? 'jambes' : z); });
    const chosen = [];
    const take = muscle => {
      const cands = pool.filter(e => e.muscle === muscle && !chosen.includes(e.id));
      if (!cands.length) return;
      cands.sort((a, b) => (used[a.id] || 0) - (used[b.id] || 0));
      const e = cands[0]; used[e.id] = (used[e.id] || 0) + 1; chosen.push(e.id);
    };
    for (const m of focus) { if (chosen.length >= maxEx) break; take(m); }
    if (p.goal === 'fat' || p.goal === 'fitness') { const c = pool.filter(e => e.muscle === 'cardio'); if (c.length) { const e = c[i % c.length]; if (!chosen.includes(e.id)) { if (chosen.length >= maxEx) chosen.pop(); chosen.push(e.id); } } }
    const items = chosen.map(id => {
      const e = EXMAP[id];
      const sets = e.time ? 3 : (lvl === 1 && ['muscle', 'strength'].includes(p.goal) ? Math.max(3, scheme.sets - 1) : scheme.sets);
      return { exId: id, sets, reps: e.time ? '30-45 s' : (e.equip === 'none' && p.goal === 'strength' ? '10-15' : scheme.reps), rest: scheme.rest, tip: e.safety };
    });
    return { dow, rest: false, name: (cycle[i % cycle.length] === UPPER ? 'Haut du corps' : cycle[i % cycle.length] === LOWER ? 'Bas du corps' : 'Corps entier') + ' ' + (i + 1), exercises: items };
  });
  const week = [];
  for (let d = 0; d < 7; d++) week.push(dayPlans.find(x => x.dow === d) || { dow: d, rest: true, name: 'Repos', exercises: [] });
  return { id: uid(), goal: p.goal, level: p.level, duration: p.duration, created: isoDay(), week, warmup: WARMUP, cooldown: COOLDOWN,
    progression: 'Quand vous réussissez toutes les séries avec une bonne technique, ajoutez 1 à 2 répétitions la semaine suivante, puis un peu de charge ou une variante plus difficile. Un jour de repos au moins entre deux séances intenses.' };
}
function programWeekNo(pr) { return Math.floor((Date.now() - new Date(pr.created + 'T12:00:00').getTime()) / (7 * 864e5)) + 1; }

/* ---------- Nutrition (valeurs INDICATIVES pour 100 g) ---------- */
const F = (id, name, cat, kcal, p, c, f, cost, allergen) => ({ id, name, cat, kcal, p, c, f, cost, allergen: allergen || '' });
const FOODS = [
  F('riz', 'Riz cuit', 'feculent', 130, 2.7, 28, 0.3, 1), F('attieke', 'Attiéké', 'feculent', 150, 1, 36, 0.3, 1),
  F('igname', 'Igname cuite', 'feculent', 118, 1.5, 28, 0.2, 1), F('plantain', 'Banane plantain cuite', 'feculent', 116, 0.8, 31, 0.2, 1),
  F('patate', 'Patate douce cuite', 'feculent', 90, 2, 21, 0.1, 1), F('pdt', 'Pomme de terre cuite', 'feculent', 87, 1.9, 20, 0.1, 1),
  F('pates', 'Pâtes cuites', 'feculent', 158, 5.8, 31, 0.9, 1, 'gluten'), F('pain', 'Pain', 'feculent', 265, 9, 49, 3.2, 1, 'gluten'),
  F('avoine', 'Flocons d\'avoine', 'feculent', 389, 17, 66, 7, 1, 'gluten'),
  F('oeuf', 'Œufs', 'proteine', 143, 12.6, 0.7, 9.5, 1, 'oeuf'), F('poisson', 'Poisson cuit (tilapia)', 'proteine', 128, 26, 0, 2.7, 2, 'poisson'),
  F('poulet', 'Poulet cuit', 'proteine', 165, 31, 0, 3.6, 2), F('haricots', 'Haricots cuits', 'proteine', 127, 8.7, 22.8, 0.5, 1),
  F('sardines', 'Sardines en conserve', 'proteine', 208, 25, 0, 11.5, 1, 'poisson'), F('thon', 'Thon en conserve', 'proteine', 116, 26, 0, 1, 2, 'poisson'),
  F('yaourt', 'Yaourt nature', 'proteine', 61, 3.5, 4.7, 3.3, 1, 'lait'),
  F('banane', 'Banane', 'fruit', 89, 1.1, 23, 0.3, 1), F('mangue', 'Mangue', 'fruit', 60, 0.8, 15, 0.4, 1),
  F('orange', 'Orange', 'fruit', 47, 0.9, 12, 0.1, 1), F('papaye', 'Papaye', 'fruit', 43, 0.5, 11, 0.3, 1),
  F('tomate', 'Tomate', 'legume', 18, 0.9, 3.9, 0.2, 1), F('epinards', 'Épinards / feuilles', 'legume', 23, 2.9, 3.6, 0.4, 1),
  F('carotte', 'Carotte', 'legume', 41, 0.9, 10, 0.2, 1), F('aubergine', 'Aubergine', 'legume', 25, 1, 6, 0.2, 1),
  F('arachide', 'Arachides', 'gras', 567, 26, 16, 49, 1, 'arachide'), F('huile', 'Huile', 'gras', 884, 0, 0, 100, 1)
];
const FMAP = Object.fromEntries(FOODS.map(f => [f.id, f]));
const ALLERGENS = { arachide: 'Arachides', oeuf: 'Œufs', poisson: 'Poisson', gluten: 'Gluten', lait: 'Lait' };
const MEALS = [
  { id: 'm1', name: 'Riz, poulet et légumes', type: 'Déjeuner', cost: 2, items: [['riz', 180], ['poulet', 120], ['tomate', 100], ['huile', 5]] },
  { id: 'm2', name: 'Attiéké et poisson', type: 'Déjeuner', cost: 2, items: [['attieke', 200], ['poisson', 150], ['tomate', 80], ['huile', 5]] },
  { id: 'm3', name: 'Igname et œufs', type: 'Dîner', cost: 1, items: [['igname', 200], ['oeuf', 120], ['tomate', 80], ['huile', 5]] },
  { id: 'm4', name: 'Riz, haricots et plantain', type: 'Déjeuner', cost: 1, items: [['riz', 180], ['haricots', 150], ['plantain', 100]] },
  { id: 'm5', name: 'Plantain, poisson et aubergine', type: 'Dîner', cost: 2, items: [['plantain', 200], ['poisson', 150], ['aubergine', 100]] },
  { id: 'm6', name: 'Omelette, pain et banane', type: 'Petit-déjeuner', cost: 1, items: [['oeuf', 120], ['pain', 60], ['banane', 100]] },
  { id: 'm7', name: 'Avoine, banane et arachides', type: 'Petit-déjeuner', cost: 1, items: [['avoine', 50], ['banane', 100], ['arachide', 15], ['yaourt', 125]] },
  { id: 'm8', name: 'Pâtes au thon et légumes', type: 'Déjeuner', cost: 2, items: [['pates', 200], ['thon', 100], ['tomate', 100], ['huile', 5]] },
  { id: 'm9', name: 'Patate douce, poulet et épinards', type: 'Dîner', cost: 2, items: [['patate', 200], ['poulet', 120], ['epinards', 100]] },
  { id: 'm10', name: 'Collation banane et arachides', type: 'Collation', cost: 1, items: [['banane', 120], ['arachide', 20]] },
  { id: 'm11', name: 'Sardines, riz et carottes', type: 'Dîner', cost: 1, items: [['riz', 180], ['sardines', 100], ['carotte', 80]] },
  { id: 'm12', name: 'Pomme de terre et œufs', type: 'Dîner', cost: 1, items: [['pdt', 250], ['oeuf', 120], ['carotte', 80]] },
  { id: 'm13', name: 'Fruits de saison (mangue, papaye, orange)', type: 'Collation', cost: 1, items: [['mangue', 100], ['papaye', 100], ['orange', 100]] }
];
const MMAP = Object.fromEntries(MEALS.map(m => [m.id, m]));
const sumItems = items => items.reduce((a, [id, g]) => { const f = FMAP[id]; if (!f) return a; const k = g / 100; return { kcal: a.kcal + f.kcal * k, p: a.p + f.p * k, c: a.c + f.c * k, f: a.f + f.f * k }; }, { kcal: 0, p: 0, c: 0, f: 0 });
const EST_NOTE = '<p class="notice">Valeurs <b>indicatives</b> pour des portions courantes (ordre de grandeur, à vérifier avec une table officielle). Elles ne remplacent pas l\'avis d\'un diététicien.</p>';
function allowedMeals() {
  const pr = U().profile || {}; const al = pr.allergies || []; const budget = Number(pr.budget) || 3;
  return MEALS.filter(m => m.cost <= budget && !m.items.some(([id]) => al.includes(FMAP[id].allergen)));
}

/* ---------- Coach (local + endpoint serveur optionnel) ---------- */
const AI_LIMIT = () => CONFIG.plans[plan()].ai;
function aiRemaining() { const d = U(); const t0 = isoDay(); if (d.ai.date !== t0) { d.ai = { date: t0, count: 0 }; } return Math.max(0, AI_LIMIT() - d.ai.count); }
const DANGER = /(st[eé]ro[iï]des?|anabolisant|clenbuterol|clenb|vomir|laxatif|pilule.*minceur|br[uû]le.?graisse miracle|je[uû]ne.*(\d+ ?jours|\d+ ?j\b)|perdre \d+ ?kg en (une|1|2|deux) semaines?|ne plus manger|arr[eê]ter de manger)/i;
const MEDICAL = /(douleur|bless|mal au|mal [aà] la|m[eé]dicament|diab[eè]te|enceinte|grossesse|tension art|cardiaque|poitrine|malaise|vertige|op[eé]r[eé]|fracture|asthme)/i;
function localCoach(q) {
  const d = U(); const pr = d.profile; const nq = norm(q);
  if (DANGER.test(nq) || DANGER.test(q)) return 'Je ne peux pas t\'aider avec ça : cette approche est dangereuse pour ta santé. Je peux en revanche te proposer une progression réaliste et durable (séances régulières, sommeil, alimentation équilibrée). Pour un objectif de poids précis, parle à un médecin ou à un diététicien.';
  if (MEDICAL.test(nq)) return 'Je ne suis pas médecin et je ne peux pas donner de conseil médical personnalisé. En cas de douleur, de blessure, de maladie, de grossesse ou de symptôme inhabituel, arrête l\'effort et consulte un professionnel de santé avant de continuer. Je peux ensuite t\'aider à adapter ton entraînement selon ses recommandations.';
  const found = EX.find(e => nq.includes(norm(e.name)) || nq.includes(e.id));
  if (/(alternativ|remplac|a la place|sans materiel|pas de materiel|variante)/.test(nq)) {
    const eq = pr ? ENV[pr.env].equip : ['none'];
    if (found) {
      const alts = EX.filter(e => e.muscle === found.muscle && e.id !== found.id && eq.includes(e.equip)).slice(0, 4);
      return `Alternatives à « ${found.name} » (${found.muscle}) avec ton matériel :\n` + (alts.length ? alts.map(a => '• ' + a.name).join('\n') : '• ' + found.variants) + `\n\nVariantes : ${found.variants}`;
    }
    return 'Dis-moi quel exercice tu veux remplacer (ex. « alternative aux pompes ») et je te propose des options adaptées à ton matériel.';
  }
  if (found && /(explique|comment|technique|faire|execut|consigne)/.test(nq) || (found && nq.length < 40)) {
    return `${found.name} — ${found.desc}\n\nSécurité : ${found.safety}\nVariantes : ${found.variants}`;
  }
  if (/(seance|entrainement|programme|aujourd)/.test(nq)) {
    if (!d.program) return 'Tu n\'as pas encore de programme. Crée-le depuis l\'onboarding (menu Programme).';
    const day = d.program.week[dowIdx()];
    if (day.rest) return 'Aujourd\'hui est un jour de repos prévu dans ton programme. Marche légère, mobilité et hydratation sont les bienvenues.';
    return `Séance du jour : ${day.name} (${d.program.duration} min environ)\n` + day.exercises.map(x => `• ${EXMAP[x.exId].name} — ${x.sets} × ${x.reps}, repos ${x.rest} s`).join('\n') + '\n\nCommence par un échauffement de 5 minutes.';
  }
  if (/(progres|resume|bilan|evolution)/.test(nq)) {
    const ms = d.measures.filter(m => m.weight).sort((a, b) => a.date.localeCompare(b.date));
    const ws = d.sessions.filter(s => new Date(s.date) >= weekStart()).length;
    let r = `Séances terminées cette semaine : ${ws}. Séances au total : ${d.sessions.length}.`;
    if (ms.length >= 2) r += `\nPoids : ${ms[0].weight} kg → ${ms[ms.length - 1].weight} kg (${fmtDate(ms[0].date)} → ${fmtDate(ms[ms.length - 1].date)}).`;
    else r += '\nAjoute au moins deux pesées pour suivre l\'évolution.';
    return r + '\nRappelle-toi : les variations d\'un jour à l\'autre sont normales, regarde la tendance.';
  }
  if (/(motivation|routine|discipline|regulier|pas envie|flemme|habitude)/.test(nq)) return 'Pour tenir dans la durée :\n• Fixe des créneaux précis (ex. 18 h, 3 jours par semaine).\n• Commence petit : 20 minutes valent mieux que zéro.\n• Prépare tes affaires la veille.\n• Note chaque séance : voir sa régularité motive.\n• Un jour raté n\'annule rien : reprends au suivant.';
  if (/(manger|repas|proteine|calorie|aliment|alimentation|regime)/.test(nq)) return 'Pour l\'alimentation : privilégie des repas simples avec une source de protéines (œufs, poisson, poulet, haricots), des féculents (riz, igname, plantain), des légumes et des fruits. Évite les régimes extrêmes. Retrouve des idées de repas adaptées à ton budget dans l\'onglet Nutrition. Pour un plan médical ou personnalisé, vois un diététicien.';
  if (/(echauff|etirement|recuper|repos|sommeil)/.test(nq)) return 'Échauffe-toi 5 minutes avant chaque séance, étire-toi doucement après, dors 7 à 9 heures et garde au moins un jour de repos entre deux séances intenses. La progression se construit pendant la récupération.';
  if (/(salut|bonjour|hello|coucou)/.test(nq)) return 'Salut ! Je peux t\'expliquer un exercice, proposer une alternative, résumer ta séance du jour ou tes progrès. Que veux-tu faire ?';
  return 'Je peux : expliquer un exercice (« comment faire des squats ? »), proposer une alternative (« alternative aux pompes »), résumer ta séance du jour, ton progrès, ou t\'aider à garder ta routine. Pose-moi une question précise.';
}
async function askCoach(q) {
  const d = U();
  if (aiRemaining() <= 0) return { text: `Limite quotidienne atteinte pour la formule ${CONFIG.plans[plan()].name} (${AI_LIMIT()} messages). Revenez demain ou passez à une formule supérieure.`, limited: true };
  d.ai.count++; save();
  const ep = d.settings.aiEndpoint;
  if (ep) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
      const pr = d.profile || {};
      const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ message: q, history: d.chat.slice(-6), context: { goal: pr.goal, level: pr.level, env: pr.env }, plan: plan() }) });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && typeof j.reply === 'string') return { text: j.reply.slice(0, 4000) };
      throw new Error('Réponse invalide');
    } catch (e) {
      return { text: 'Le service IA est momentanément indisponible. Réponse de secours du coach local :\n\n' + localCoach(q) };
    }
  }
  return { text: localCoach(q) };
}

/* ---------- Graphiques ---------- */
function lineChart(pts, unit, label) {
  if (pts.length < 2) return '<div class="empty">Enregistrez au moins deux mesures pour voir le graphique.</div>';
  const W = 600, H = 220, P = 36; const vs = pts.map(p => p.v);
  let mn = Math.min(...vs), mx = Math.max(...vs); if (mn === mx) { mn -= 1; mx += 1; }
  const x = i => P + i * (W - 2 * P) / (pts.length - 1), y = v => H - P - (v - mn) / (mx - mn) * (H - 2 * P);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="#c6ff3d"><title>${esc(fmtDate(p.d))} : ${p.v} ${unit}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} : de ${pts[0].v} à ${pts[pts.length - 1].v} ${unit}">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#2b2e34"/><line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#2b2e34"/>
    <path d="${path}" fill="none" stroke="#c6ff3d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${P - 6}" y="${P + 4}" fill="#a3a8b0" font-size="12" text-anchor="end">${mx}</text><text x="${P - 6}" y="${H - P + 4}" fill="#a3a8b0" font-size="12" text-anchor="end">${mn}</text>
    <text x="${P}" y="${H - 10}" fill="#a3a8b0" font-size="12">${esc(fmtDate(pts[0].d))}</text><text x="${W - P}" y="${H - 10}" fill="#a3a8b0" font-size="12" text-anchor="end">${esc(fmtDate(pts[pts.length - 1].d))}</text></svg>`;
}
function weeklyBars(sessions) {
  const W = 600, H = 160, P = 28; const weeks = [];
  const ws = weekStart();
  for (let i = 7; i >= 0; i--) { const s = new Date(ws); s.setDate(s.getDate() - i * 7); const e = new Date(s); e.setDate(e.getDate() + 7); weeks.push({ s, n: sessions.filter(x => { const d = new Date(x.date); return d >= s && d < e; }).length }); }
  const mx = Math.max(1, ...weeks.map(w => w.n)); const bw = (W - 2 * P) / weeks.length;
  if (!sessions.length) return '<div class="empty">Aucune séance terminée pour le moment.</div>';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Séances terminées par semaine sur 8 semaines">` + weeks.map((w, i) => {
    const h = w.n / mx * (H - 2 * P);
    return `<rect x="${P + i * bw + 6}" y="${H - P - h}" width="${bw - 12}" height="${Math.max(h, 2)}" rx="6" fill="#c6ff3d" opacity="${w.n ? 1 : .25}"><title>${w.n} séance(s)</title></rect><text x="${P + i * bw + bw / 2}" y="${H - 8}" fill="#a3a8b0" font-size="11" text-anchor="middle">${pad(w.s.getDate())}/${pad(w.s.getMonth() + 1)}</text><text x="${P + i * bw + bw / 2}" y="${H - P - h - 5}" fill="#f4f5f6" font-size="12" text-anchor="middle">${w.n || ''}</text>`;
  }).join('') + '</svg>';
}

/* ---------- Rendu / routeur ---------- */
const PRIVATE = ['dashboard', 'onboarding', 'program', 'session', 'history', 'nutrition', 'meal', 'progress', 'coach', 'notifications', 'subscription', 'settings'];
let timerId = null, params = new URLSearchParams();
const view = html => { $('#app').innerHTML = html; };
const goto = r => { if (location.hash === '#/' + r) route(); else location.hash = '#/' + r; };
const PUB_NAV = [['home', '🏠'], ['features', '✨'], ['pricing', '💳'], ['faq', '❓'], ['login', '🔑']];
const PRIV_NAV = [['dashboard', '📊'], ['program', '🏋️'], ['nutrition', '🍽️'], ['progress', '📈'], ['coach', '💬']];
const SIDE_EXTRA = [['notifications', '🔔'], ['subscription', '💳'], ['settings', '⚙️']];
function chrome(current) {
  const priv = !!me();
  const link = ([k, ic], cls) => `<a ${cls ? `class="${cls}"` : ''} href="#/${k}" ${current === k ? 'aria-current="page"' : ''}>${cls ? ic + ' ' : `<span aria-hidden="true">${ic}</span>`}${esc(t(k))}</a>`;
  $('#side').innerHTML = `<a class="logo" href="#/${priv ? 'dashboard' : 'home'}" style="margin-bottom:20px"><span class="dot"></span>Body<b>Transformation</b> AI</a>` +
    (priv ? [...PRIV_NAV, ...SIDE_EXTRA].map(x => link(x, 'navlink')).join('') + '<button class="btn sm" data-act="logout" style="margin-top:14px;width:100%">Déconnexion</button>'
      : [['home', '🏠'], ['features', '✨'], ['programs', '🏋️'], ['pricing', '💳'], ['faq', '❓'], ['login', '🔑'], ['signup', '📝']].map(x => link(x, 'navlink')).join(''));
  $('#bottom').innerHTML = (priv ? PRIV_NAV : PUB_NAV).map(x => link(x)).join('');
  const unread = priv ? U().notifs.filter(n => !n.read).length : 0;
  $('#top').innerHTML = `<a class="logo" href="#/${priv ? 'dashboard' : 'home'}"><span class="dot"></span>Body<b>Transformation</b> AI</a>
    <div class="row">
      <div class="cur" role="group" aria-label="Langue">${['fr', 'en'].map(l => `<button data-act="lang" data-v="${l}" aria-pressed="${lang() === l}">${l.toUpperCase()}</button>`).join('')}</div>
      ${priv ? `<a class="btn sm" href="#/notifications" aria-label="Notifications (${unread} non lues)">🔔${unread ? ' ' + unread : ''}</a><button class="btn sm" data-act="logout">${t('logout')}</button>` : `<a class="btn sm" href="#/login">${t('login')}</a><a class="btn sm primary" href="#/signup">${t('signup')}</a>`}
    </div>`;
  $('#foot').innerHTML = `© ${new Date().getFullYear()} ${CONFIG.appName} · <a href="#/terms">Conditions</a><a href="#/privacy">Confidentialité</a><a href="#/contact">Contact</a><br><small>Ne remplace pas un médecin ni un diététicien. Aucun résultat n'est garanti.</small>`;
}
function route() {
  clearInterval(timerId); timerId = null;
  const raw = location.hash.replace(/^#\/?/, ''); const [path, qs] = raw.split('?');
  const name = path || 'home'; params = new URLSearchParams(qs || '');
  if (PRIVATE.includes(name) && !me()) { toast('Connectez-vous pour accéder à cette page.', true); location.hash = '#/login'; return; }
  if (me() && ['login', 'signup'].includes(name)) { location.hash = '#/dashboard'; return; }
  if (me() && name !== 'onboarding' && !U().profile && PRIVATE.includes(name) && !['settings', 'subscription', 'notifications'].includes(name)) { location.hash = '#/onboarding'; return; }
  const fn = PAGES[name] || PAGES.notfound;
  chrome(name === 'meal' ? 'nutrition' : name === 'session' || name === 'history' ? 'program' : name);
  fn(); $('#app').focus({ preventScroll: true }); window.scrollTo(0, 0);
  document.title = (name === 'home' ? '' : (t(name) !== name ? t(name) : name) + ' · ') + CONFIG.appName;
}
window.addEventListener('hashchange', route);

/* ---------- Pages publiques ---------- */
const PAGES = {};
PAGES.home = () => view(`
  <section class="hero"><span class="badge">Coach sportif intelligent</span>
    <h1 style="margin-top:14px">${lang() === 'en' ? 'Transform your body. Build your <em>discipline.</em>' : 'Transforme ton physique. Construis ta <em>discipline.</em>'}</h1>
    <p style="font-size:1.1rem;max-width:620px">${t('heroSub')}</p>
    <div class="row"><a class="btn primary" href="#/${me() ? (U().profile ? 'program' : 'onboarding') : 'signup'}">${t('createProgram')}</a>
      ${me() ? '' : `<a class="btn" href="#/login">${t('login')}</a>`}<a class="btn" href="#/pricing">${t('seePricing')}</a></div>
  </section>
  <div class="grid g3">
    ${[['🏋️', 'Programmes personnalisés', 'Selon ton objectif, ton niveau, ton matériel et tes disponibilités.'], ['🍽️', 'Nutrition adaptée', 'Idées de repas ouest-africains et européens selon ton budget et tes allergies.'], ['📈', 'Suivi réel', 'Poids, tour de taille, séances et photos privées, avec graphiques.']].map(([i, h, p]) => `<div class="card hover"><div style="font-size:1.8rem">${i}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}
  </div>
  <p class="notice">BodyTransformation AI ne remplace pas un médecin, un diététicien ou un coach diplômé. Aucun résultat n'est garanti : les progrès dépendent de ta régularité.</p>`);
PAGES.features = () => view(`<h1>Fonctionnalités</h1><div class="grid g2">
  ${[['Onboarding en 6 étapes', 'Objectif, profil, environnement, préférences, contraintes, résumé modifiable.'], ['Génération du programme', 'Échauffement, séries, répétitions, repos, retour au calme, jours de repos et progression.'], ['Séances guidées', 'Démarrer, cocher, enregistrer séries/répétitions/charge, pause, difficulté ressentie, historique.'], ['Bibliothèque d\'exercices', 'Description, groupe musculaire, niveau, matériel, consignes de sécurité, variantes.'], ['Nutrition', 'Repas, menu de la semaine, liste de courses, remplacement d\'ingrédient, budget, allergies.'], ['Suivi des progrès', 'Poids, tour de taille, mensurations, notes, photos privées, comparaison, export.'], ['Coach', 'Explications, alternatives, résumé de séance, conseils de routine, refus des demandes dangereuses.'], ['Vie privée', 'Export et suppression de vos données à tout moment.']].map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`);
PAGES.programs = () => view(`<h1>Programmes</h1><p>Les programmes sont générés à partir de vos réponses. Types disponibles :</p><div class="grid g2">
  ${Object.entries(GOALS).map(([k, v]) => `<div class="card"><h3>${v}</h3><p>${{ fat: 'Séances avec cardio et circuits (12-15 répétitions, repos courts).', muscle: 'Séries de 8-12 répétitions avec progression de charge.', fitness: 'Équilibre force et cardio pour gagner en énergie.', strength: 'Séries lourdes, repos longs, technique d\'abord.', maintain: 'Volume modéré pour conserver vos acquis.' }[k]}</p></div>`).join('')}</div>
  <h2>Bibliothèque (${EX.length} exercices)</h2><div class="card tablewrap"><table><tr><th>Exercice</th><th>Muscle</th><th>Niveau</th><th>Matériel</th></tr>
  ${EX.map(e => `<tr><td><a href="#/programs" data-act="exinfo" data-id="${e.id}">${esc(e.name)}</a></td><td>${e.muscle}</td><td>${['', 'Débutant', 'Intermédiaire', 'Avancé'][e.level]}</td><td>${{ none: 'Aucun', dumbbell: 'Haltères', gym: 'Salle', outdoor: 'Extérieur' }[e.equip]}</td></tr>`).join('')}</table></div><div id="exinfo"></div>
  <a class="btn primary" href="#/${me() ? 'program' : 'signup'}">${t('createProgram')}</a>`);
PAGES.pricing = () => {
  const cur = me() ? U().settings.currency : (DB.cur || 'XOF'); const period = params.get('p') === 'year' ? 'year' : 'month';
  const feats = { free: ['Création du profil', 'Programme de démarrage limité (3 jours, 4 exercices)', 'Suivi élémentaire (poids, tour de taille)', `Coach : ${CONFIG.plans.free.ai} messages/jour`], pro: ['Programmes personnalisés complets', 'Séances et ajustements du programme', 'Suivi complet + photos', 'Plans alimentaires et liste de courses', 'Historique complet', `Coach : ${CONFIG.plans.pro.ai} messages/jour`], elite: ['Toutes les fonctionnalités Pro', 'Programmes avancés', 'Analyses enrichies', 'Personnalisation supplémentaire', `Coach : ${CONFIG.plans.elite.ai} messages/jour`] };
  view(`<h1>Tarifs</h1><div class="row between" style="margin-bottom:16px"><div class="row"><a class="btn sm ${period === 'month' ? 'primary' : ''}" href="#/pricing?p=month">Mensuel</a><a class="btn sm ${period === 'year' ? 'primary' : ''}" href="#/pricing?p=year">Annuel (−${Math.round(CONFIG.annualDiscount * 100)} %)</a></div>
    <div class="cur" role="group" aria-label="Devise">${['XOF', 'EUR', 'USD'].map(c => `<button data-act="cur" data-v="${c}" aria-pressed="${cur === c}">${c === 'XOF' ? 'FCFA' : c}</button>`).join('')}</div></div>
    <div class="grid g3">${Object.keys(CONFIG.plans).map(k => `<div class="card ${k === 'pro' ? '' : ''}" ${k === 'pro' ? 'style="border-color:var(--accent)"' : ''}><h3>${CONFIG.plans[k].name} ${k === 'pro' ? '<span class="badge">Populaire</span>' : ''}</h3>
      <div class="price">${money(priceOf(k, period), cur)}<small> /${period === 'year' ? 'an' : 'mois'}</small></div><ul class="tick">${feats[k].map(f => `<li>${f}</li>`).join('')}</ul>
      <a class="btn ${k === 'pro' ? 'primary' : ''}" href="#/${me() ? 'subscription' : 'signup'}">${k === 'free' ? 'Commencer' : 'Choisir ' + CONFIG.plans[k].name}</a></div>`).join('')}</div>
    <p class="notice">Prix de départ modifiables. Les conversions EUR/USD sont indicatives. Aucun résultat n'est garanti.</p>`);
};
PAGES.faq = () => view(`<h1>FAQ</h1>` + [
  ['Mes données sont-elles privées ?', 'Dans cette version, elles sont enregistrées uniquement dans votre navigateur. Vous pouvez les exporter ou les supprimer dans Paramètres.'],
  ['Le coach remplace-t-il un professionnel de santé ?', 'Non. Il donne des conseils généraux de fitness et refuse les demandes dangereuses. Consultez un médecin en cas de doute ou de douleur.'],
  ['Puis-je m\'entraîner sans matériel ?', 'Oui : l\'onboarding propose maison sans matériel, maison équipée, salle ou extérieur.'],
  ['Garantissez-vous des résultats ?', 'Non. Les résultats dépendent de nombreux facteurs, dont votre régularité.'],
  ['Comment payer ?', 'Le paiement réel (Mobile Money, carte) nécessite un serveur relié à CinetPay, Paystack ou équivalent. Un mode test, clairement identifié, est disponible pour essayer les formules.'],
  ['Puis-je supprimer mon compte ?', 'Oui, dans Paramètres, avec suppression définitive de vos données locales.']
].map(([q, a]) => `<details class="card"><summary><b>${q}</b></summary><p style="margin-top:10px">${a}</p></details>`).join(''));
PAGES.terms = () => view(`<h1>Conditions d'utilisation</h1><p class="notice warn">Modèle à faire relire par un juriste avant commercialisation.</p>
  <div class="card"><h3>1. Objet</h3><p>${CONFIG.appName} propose des programmes d'entraînement et des idées de repas à titre informatif.</p><h3>2. Santé</h3><p>Le service ne remplace pas un avis médical. Consultez un professionnel avant de commencer une activité physique, surtout en cas de pathologie, de grossesse ou de douleur. Vous vous entraînez sous votre responsabilité.</p><h3>3. Compte</h3><p>Vous êtes responsable de la confidentialité de votre mot de passe et de l'exactitude des informations fournies.</p><h3>4. Abonnements</h3><p>Les formules payantes sont activées après confirmation réelle du paiement par le prestataire. Les conditions de renouvellement et de remboursement sont à préciser par l'éditeur.</p><h3>5. Résultats</h3><p>Aucun résultat n'est garanti.</p></div>`);
PAGES.privacy = () => view(`<h1>Politique de confidentialité</h1><p class="notice warn">Modèle à faire relire par un juriste (RGPD et lois locales applicables).</p>
  <div class="card"><h3>Données collectées</h3><p>Prénom, e-mail, informations de profil sportif, mesures, notes et photos de progression que vous saisissez. Rien d'autre.</p><h3>Où sont-elles stockées ?</h3><p>Dans cette version, uniquement dans le stockage local de votre navigateur : elles ne sont pas envoyées à un serveur, sauf si vous configurez vous-même un service IA dans Paramètres.</p><h3>Photos</h3><p>Privées, jamais utilisées pour entraîner une IA et jamais modifiées.</p><h3>Vos droits</h3><p>Accès et export (Paramètres → Exporter), rectification, suppression du compte et des données à tout moment.</p><h3>Marketing</h3><p>Aucun message marketing sans votre consentement explicite (désactivé par défaut).</p></div>`);
PAGES.contact = () => view(`<h1>Contact</h1><form class="card" data-form="contact" style="max-width:560px">
  <div class="field"><label for="c-n">Nom</label><input id="c-n" name="n" required autocomplete="name"></div>
  <div class="field"><label for="c-s">Sujet</label><input id="c-s" name="s" required></div>
  <div class="field"><label for="c-m">Message</label><textarea id="c-m" name="m" required></textarea></div>
  <button class="btn primary">Ouvrir mon application e-mail</button><p style="margin-top:10px;font-size:.85rem">Le message est préparé dans votre application e-mail à destination de ${esc(CONFIG.contactEmail)}.</p></form>`);
PAGES.notfound = () => view('<div class="empty"><h1>Page introuvable</h1><a class="btn primary" href="#/home">Retour à l\'accueil</a></div>');
PAGES.verify = () => view(`<h1>Vérification de l'e-mail</h1><div class="card"><p class="notice warn">La vérification par e-mail nécessite un serveur d'envoi (Supabase Auth, par exemple). Cette version navigateur ne peut pas envoyer d'e-mail ; votre adresse n'est donc pas vérifiée.</p><a class="btn" href="#/login">Retour</a></div>`);
PAGES.forgot = () => view(`<h1>Mot de passe oublié</h1><div class="card" style="max-width:520px"><p class="notice warn">La réinitialisation par e-mail nécessite un serveur. Dans cette version, si vous êtes connecté vous pouvez changer votre mot de passe dans Paramètres. Si vous l'avez oublié, vous pouvez créer un nouveau compte (les données restent liées à l'ancien).</p><a class="btn" href="#/login">Connexion</a> <a class="btn" href="#/reset">Changer le mot de passe</a></div>`);
PAGES.reset = () => me() ? (goto('settings')) : view(`<h1>Réinitialisation du mot de passe</h1><div class="card"><p class="notice warn">Connectez-vous d'abord, puis changez votre mot de passe dans Paramètres. La réinitialisation par lien e-mail exige un serveur.</p><a class="btn primary" href="#/login">Connexion</a></div>`);
PAGES.success = () => {
  view(`<h1>Retour de paiement</h1><div class="card" id="payres"><p>Vérification du statut côté serveur…</p></div>`);
  const box = $('#payres');
  if (!me()) { box.innerHTML = '<p>Connectez-vous pour consulter votre abonnement.</p><a class="btn primary" href="#/login">Connexion</a>'; return; }
  if (!CONFIG.statusEndpoint) { box.innerHTML = `<p class="notice warn">Cette page n'active <b>jamais</b> un abonnement : seule la confirmation du prestataire (webhook vérifié par votre serveur) le peut. Aucun serveur de statut n'est configuré dans cette version.</p><a class="btn primary" href="#/subscription">Voir mon abonnement</a>`; return; }
  fetch(CONFIG.statusEndpoint + '?email=' + encodeURIComponent(me().email)).then(r => r.json()).then(j => {
    if (j && RANK[j.plan] > 0 && j.until && j.until > Date.now()) { U().plan = j.plan; U().planUntil = j.until; save(); box.innerHTML = `<p>✅ Paiement confirmé par le serveur. Formule <b>${CONFIG.plans[j.plan].name}</b> active.</p>`; }
    else box.innerHTML = '<p>Le paiement n\'est pas encore confirmé par le serveur. Réessayez dans quelques minutes.</p>';
  }).catch(() => box.innerHTML = '<p class="err">Impossible de joindre le serveur de statut.</p>');
};
PAGES.cancel = () => view('<h1>Paiement annulé</h1><div class="card"><p>Aucun montant n\'a été débité et aucun abonnement n\'a été activé.</p><a class="btn primary" href="#/pricing">Retour aux tarifs</a></div>');

/* ---------- Connexion / Inscription ---------- */
PAGES.login = () => view(`<h1>Connexion</h1><form class="card" data-form="login" style="max-width:460px" novalidate>
  <div class="field"><label for="l-e">E-mail</label><input id="l-e" name="email" type="email" autocomplete="email" required></div>
  <div class="field"><label for="l-p">Mot de passe</label><input id="l-p" name="pw" type="password" autocomplete="current-password" required></div>
  <div class="err" id="l-err" role="alert"></div><button class="btn primary" style="width:100%">Se connecter</button>
  <p style="margin:12px 0 0"><a href="#/forgot">Mot de passe oublié ?</a> · <a href="#/signup">Créer un compte</a></p></form>
  <p class="notice">Comptes et données stockés dans ce navigateur uniquement.</p>`);
PAGES.signup = () => view(`<h1>Inscription</h1><form class="card" data-form="signup" style="max-width:460px" novalidate>
  <div class="field"><label for="s-n">Prénom</label><input id="s-n" name="name" autocomplete="given-name" required maxlength="40"></div>
  <div class="field"><label for="s-e">E-mail</label><input id="s-e" name="email" type="email" autocomplete="email" required></div>
  <div class="field"><label for="s-p">Mot de passe (8 caractères minimum)</label><input id="s-p" name="pw" type="password" autocomplete="new-password" required minlength="8"></div>
  <label class="check field"><input type="checkbox" name="cgu" required> <span>J'accepte les <a href="#/terms">conditions d'utilisation</a> et la <a href="#/privacy">politique de confidentialité</a>.</span></label>
  <div class="err" id="s-err" role="alert"></div><button class="btn primary" style="width:100%">Créer mon compte</button></form>`);
const FORMS = {};
FORMS.login = async (fd) => {
  const email = String(fd.get('email')).trim().toLowerCase(), pw = String(fd.get('pw')); const err = $('#l-err');
  const at = DB.attempts[email] || { n: 0, until: 0 };
  if (Date.now() < at.until) { err.textContent = `Trop de tentatives. Réessayez dans ${Math.ceil((at.until - Date.now()) / 1000)} s.`; return; }
  const u = DB.users[email];
  try {
    const ok = u && (await hashPw(pw, u.salt)) === u.hash;
    if (!ok) { at.n++; if (at.n >= 5) { at.until = Date.now() + 60000; at.n = 0; } DB.attempts[email] = at; save(); err.textContent = 'E-mail ou mot de passe incorrect.'; return; }
    delete DB.attempts[email]; DB.session = email; save(); toast('Bienvenue ' + u.name + ' !'); goto(u.data.profile ? 'dashboard' : 'onboarding');
  } catch (e) { err.textContent = e.message; }
};
FORMS.signup = async (fd) => {
  const name = String(fd.get('name')).trim(), email = String(fd.get('email')).trim().toLowerCase(), pw = String(fd.get('pw')); const err = $('#s-err');
  if (!name) return err.textContent = 'Indiquez votre prénom.';
  if (!emailOk(email)) return err.textContent = 'E-mail invalide.';
  if (pw.length < 8) return err.textContent = 'Le mot de passe doit contenir au moins 8 caractères.';
  if (!fd.get('cgu')) return err.textContent = 'Vous devez accepter les conditions d\'utilisation.';
  if (DB.users[email]) return err.textContent = 'Un compte existe déjà avec cet e-mail.';
  try {
    const salt = rndSalt(); const hash = await hashPw(pw, salt);
    DB.users[email] = { email, name, salt, hash, created: Date.now(), verified: false, data: newData() }; DB.session = email;
    save(); notify('system', 'Compte créé. Complétez le questionnaire pour générer votre programme.'); toast('Compte créé !'); goto('onboarding');
  } catch (e) { err.textContent = e.message; }
};
FORMS.contact = fd => {
  const s = encodeURIComponent(String(fd.get('s'))), b = encodeURIComponent(String(fd.get('m')) + '\n\n— ' + String(fd.get('n')));
  location.href = `mailto:${CONFIG.contactEmail}?subject=${s}&body=${b}`;
};

/* ---------- Onboarding ---------- */
let OB = null;
const OB_STEPS = ['Objectif', 'Profil', 'Environnement', 'Préférences', 'Contraintes', 'Résumé'];
PAGES.onboarding = () => {
  if (!OB) OB = { step: 0, d: Object.assign({ goal: '', age: '', height: '', weight: '', target: '', level: 'debutant', days: [0, 2, 4], env: '', duration: 45, focus: [], avoid: '', foods: '', budget: 2, meals: 3, allergies: [], limits: '', consent: false, motivation: 'moyenne', avail: '' }, U().profile || {}) };
  drawOB();
};
function obCollect() {
  const f = $('#obform'); if (!f) return; const d = OB.d;
  $$('input[type=text],input[type=number],select,textarea', f).forEach(el => { if (el.name) d[el.name] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value; });
  ['days', 'focus', 'allergies'].forEach(k => { if ($$(`input[name="${k}"]`, f).length) d[k] = $$(`input[name="${k}"]:checked`, f).map(x => k === 'days' ? Number(x.value) : x.value); });
  const c = $('input[name="consent"]', f); if (c) d.consent = c.checked;
}
function obValid(step) {
  const d = OB.d;
  if (step === 0 && !d.goal) return 'Choisissez un objectif.';
  if (step === 1) {
    if (!(d.age >= 13 && d.age <= 90)) return 'Âge entre 13 et 90 ans.';
    if (!(d.height >= 120 && d.height <= 230)) return 'Taille entre 120 et 230 cm.';
    if (!(d.weight >= 30 && d.weight <= 300)) return 'Poids entre 30 et 300 kg.';
    if (d.target !== '' && !(d.target >= 30 && d.target <= 300)) return 'Poids cible invalide.';
    if (!d.days.length) return 'Choisissez au moins un jour d\'entraînement.';
    if (d.days.length > 6) return 'Gardez au moins un jour de repos.';
  }
  if (step === 2 && !d.env) return 'Choisissez où vous vous entraînez.';
  if (step === 4 && d.limits.trim() && !d.consent) return 'Cochez le consentement pour enregistrer vos limitations.';
  return '';
}
function drawOB() {
  const d = OB.d, s = OB.step; let body = '';
  const pick = (k, opts) => `<div class="opts" role="group">${Object.entries(opts).map(([v, l]) => `<button type="button" class="opt" data-act="obpick" data-k="${k}" data-v="${v}" aria-pressed="${d[k] === v}">${l}</button>`).join('')}</div>`;
  if (s === 0) body = `<h2>Quel est ton objectif principal ?</h2>${pick('goal', GOALS)}`;
  if (s === 1) body = `<h2>Ton profil</h2><div class="grid g2"><div class="field"><label for="o-a">Âge</label><input id="o-a" name="age" type="number" min="13" max="90" value="${d.age}"></div>
    <div class="field"><label for="o-h">Taille (cm)</label><input id="o-h" name="height" type="number" value="${d.height}"></div>
    <div class="field"><label for="o-w">Poids (kg)</label><input id="o-w" name="weight" type="number" step="0.1" value="${d.weight}"></div>
    <div class="field"><label for="o-t">Poids cible (facultatif)</label><input id="o-t" name="target" type="number" step="0.1" value="${d.target}"></div>
    <div class="field"><label for="o-l">Niveau</label><select id="o-l" name="level">${[['debutant', 'Débutant'], ['intermediaire', 'Intermédiaire'], ['avance', 'Avancé']].map(([v, l]) => `<option value="${v}" ${d.level === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;margin-bottom:6px">Jours disponibles</legend><div class="row">${DOW.map((n, i) => `<label class="check" style="margin:0"><input type="checkbox" name="days" value="${i}" ${d.days.includes(i) ? 'checked' : ''}> ${n.slice(0, 3)}</label>`).join('')}</div></fieldset>`;
  if (s === 2) body = `<h2>Où t'entraînes-tu ?</h2>${pick('env', Object.fromEntries(Object.entries(ENV).map(([k, v]) => [k, v.label])))}`;
  if (s === 3) body = `<h2>Tes préférences</h2><div class="grid g2"><div class="field"><label for="o-d">Durée des séances</label><select id="o-d" name="duration">${[30, 45, 60, 75].map(v => `<option value="${v}" ${Number(d.duration) === v ? 'selected' : ''}>${v} min</option>`).join('')}</select></div>
    <div class="field"><label for="o-b">Budget alimentaire</label><select id="o-b" name="budget">${[[1, 'Serré'], [2, 'Moyen'], [3, 'Confortable']].map(([v, l]) => `<option value="${v}" ${Number(d.budget) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="o-m">Repas par jour</label><select id="o-m" name="meals">${[2, 3, 4, 5].map(v => `<option ${Number(d.meals) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <fieldset style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:600;margin-bottom:6px">Zones à renforcer en priorité</legend><div class="row">${[['abdos', 'Abdominaux'], ['jambes', 'Jambes'], ['fessiers', 'Fessiers']].map(([v, l]) => `<label class="check" style="margin:0"><input type="checkbox" name="focus" value="${v}" ${d.focus.includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>
    <div class="field"><label for="o-av">Exercices à éviter (séparés par des virgules)</label><input id="o-av" type="text" name="avoid" value="${esc(d.avoid)}"></div>
    <div class="field"><label for="o-f">Aliments préférés (facultatif)</label><input id="o-f" type="text" name="foods" value="${esc(d.foods)}"></div>
    <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;margin-bottom:6px">Allergies alimentaires (ces aliments seront exclus)</legend><div class="row">${Object.entries(ALLERGENS).map(([v, l]) => `<label class="check" style="margin:0"><input type="checkbox" name="allergies" value="${v}" ${d.allergies.includes(v) ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>`;
  if (s === 4) body = `<h2>Contraintes</h2><div class="field"><label for="o-lm">Limitations physiques (facultatif)</label><textarea id="o-lm" name="limits" placeholder="ex. douleur au genou">${esc(d.limits)}</textarea></div>
    <label class="check field"><input type="checkbox" name="consent" ${d.consent ? 'checked' : ''}> <span>Je consens à ce que cette information de santé soit enregistrée dans mon profil pour adapter mon programme (supprimable à tout moment).</span></label>
    <div class="field"><label for="o-mo">Motivation actuelle</label><select id="o-mo" name="motivation">${[['faible', 'Faible'], ['moyenne', 'Moyenne'], ['elevee', 'Élevée']].map(([v, l]) => `<option value="${v}" ${d.motivation === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="o-vl">Précisions sur tes disponibilités (facultatif)</label><input id="o-vl" type="text" name="avail" value="${esc(d.avail)}"></div>
    <p class="notice">En cas de pathologie, de douleur, de grossesse ou de traitement, demande l'avis d'un médecin avant de commencer.</p>`;
  if (s === 5) body = `<h2>Résumé</h2><div class="card"><table>${[['Objectif', GOALS[d.goal], 0], ['Âge / taille / poids', `${d.age} ans · ${d.height} cm · ${d.weight} kg${d.target ? ' → ' + d.target + ' kg' : ''}`, 1], ['Niveau', d.level, 1], ['Jours', d.days.map(i => DOW[i].slice(0, 3)).join(', '), 1], ['Environnement', ENV[d.env].label, 2], ['Séances', d.duration + ' min', 3], ['Budget / repas', ['', 'Serré', 'Moyen', 'Confortable'][d.budget] + ' · ' + d.meals + ' repas/jour', 3], ['Allergies', d.allergies.map(a => ALLERGENS[a]).join(', ') || 'aucune', 3], ['Limitations', d.limits || 'aucune', 4]].map(([k, v, st]) => `<tr><th>${k}</th><td>${esc(v)}</td><td><button type="button" class="btn sm" data-act="obgo" data-s="${st}">Modifier</button></td></tr>`).join('')}</table></div>`;
  view(`<h1>Questionnaire</h1><div class="steps" aria-label="Étape ${s + 1} sur 6">${OB_STEPS.map((_, i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>
    <p>Étape ${s + 1}/6 — ${OB_STEPS[s]}</p><form id="obform" class="card" novalidate>${body}<div class="err" id="ob-err" role="alert"></div>
    <div class="row between" style="margin-top:16px"><button type="button" class="btn" data-act="obprev" ${s === 0 ? 'disabled' : ''}>Retour</button><button type="button" class="btn primary" data-act="obnext">${s === 5 ? 'Générer mon programme' : 'Continuer'}</button></div></form>`);
}
function obFinish() {
  const d = U(); const p = Object.assign({}, OB.d); p.age = Number(p.age); p.height = Number(p.height); p.weight = Number(p.weight);
  if (!p.limits.trim()) p.consent = false;
  d.profile = p; d.program = generateProgram(p);
  if (!d.measures.length) d.measures.push({ id: uid(), date: isoDay(), weight: p.weight });
  save(); notify('system', 'Votre programme initial a été généré.'); OB = null; toast('Programme créé !'); goto('program');
}

/* ---------- Tableau de bord ---------- */
PAGES.dashboard = () => {
  const d = U(), pr = d.profile, prog = d.program; const dayIdx = dowIdx(); const today = prog && prog.week[dayIdx];
  const ws = weekStart(); const done = d.sessions.filter(s => new Date(s.date) >= ws).length; const planned = prog ? prog.week.filter(x => !x.rest).length : 0;
  const weights = d.measures.filter(m => m.weight).sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ d: m.date, v: m.weight }));
  const waists = d.measures.filter(m => m.waist).sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ d: m.date, v: m.waist }));
  const meals = allowedMeals(); const sug = meals.length ? meals[(Math.floor(Date.now() / 864e5)) % meals.length] : null;
  const bmi = pr.weight && pr.height ? pr.weight / Math.pow(pr.height / 100, 2) : 0;
  const warn = [];
  if (bmi && bmi < 18.5 && pr.goal === 'fat') warn.push('Ton IMC estimé est bas : une perte de graisse n\'est probablement pas adaptée. Parle-en à un professionnel de santé.');
  if (pr.age < 16 || pr.age > 65 || pr.limits) warn.push('Compte tenu de ton profil, l\'avis d\'un médecin avant de commencer est recommandé.');
  view(`<h1>Bonjour ${esc(me().name)} 👋</h1><p>Objectif : <span class="badge">${GOALS[pr.goal]}</span></p>
    ${warn.map(w => `<p class="notice warn">${w}</p>`).join('')}
    <div class="grid g2"><div class="card"><h3>Séance du jour</h3>${!prog ? '<div class="empty">Pas encore de programme.</div><a class="btn primary" href="#/onboarding">Créer</a>' : today.rest ? '<p>Jour de repos 😌 — marche légère, mobilité, hydratation.</p>' : `<p><b>${esc(today.name)}</b> · ${today.exercises.length} exercices · ~${prog.duration} min</p><a class="btn primary" href="#/session?d=${dayIdx}">${d.active ? 'Reprendre la séance' : 'Démarrer'}</a>`}</div>
    <div class="card"><h3>Objectif de la semaine</h3><div class="stat">${done}<small> / ${planned} séances</small></div><div class="bar" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${planned}"><div style="width:${planned ? Math.min(100, done / planned * 100) : 0}%"></div></div></div></div>
    <div class="card"><h3>Programme de la semaine</h3><div class="tablewrap"><table>${prog ? prog.week.map((x, i) => `<tr ${i === dayIdx ? 'style="color:var(--accent)"' : ''}><td>${DOW[i]}</td><td>${esc(x.name)}</td><td>${x.rest ? '—' : x.exercises.length + ' exercices'}</td></tr>`).join('') : ''}</table></div></div>
    <div class="grid g2"><div class="card"><h3>Poids (kg)</h3>${lineChart(weights, 'kg', 'Historique du poids')}</div><div class="card"><h3>Tour de taille (cm)</h3>${lineChart(waists, 'cm', 'Historique du tour de taille')}</div></div>
    <div class="card"><h3>Séances par semaine</h3>${weeklyBars(d.sessions)}</div>
    <div class="grid g2"><div class="card"><h3>Suggestion de repas</h3>${sug ? `<p><b>${esc(sug.name)}</b> (${sug.type})</p><a class="btn sm" href="#/meal?id=${sug.id}">Voir</a>` : '<p>Aucun repas compatible avec vos allergies/budget.</p>'}</div>
    <div class="card"><h3>Coach</h3><p>Pose une question, demande une alternative ou un résumé.</p><a class="btn sm primary" href="#/coach">Ouvrir le coach</a></div></div>
    <div class="grid g2"><div class="card"><h3>Activités récentes</h3>${d.sessions.length ? d.sessions.slice(-5).reverse().map(s => `<p style="margin:0 0 6px">✅ ${esc(s.name)} — ${fmtDate(s.date)} (${Math.round(s.durationMs / 60000)} min)</p>`).join('') : '<div class="empty">Aucune séance terminée.</div>'}</div>
    <div class="card"><h3>Notifications</h3>${d.notifs.slice(0, 3).map(n => `<p style="margin:0 0 6px">🔔 ${esc(n.text)}</p>`).join('') || '<div class="empty">Rien de nouveau.</div>'}<a href="#/notifications">Tout voir</a></div></div>`);
};

/* ---------- Programme / séances ---------- */
PAGES.program = () => {
  const d = U(), pr = d.program; if (!pr) return view('<div class="empty"><p>Pas encore de programme.</p><a class="btn primary" href="#/onboarding">Créer mon programme</a></div>');
  view(`<div class="row between"><h1>Mon programme</h1><div class="row"><a class="btn sm" href="#/history">Historique</a><a class="btn sm" href="#/onboarding" data-act="redo">Régénérer</a></div></div>
    <p>${GOALS[pr.goal]} · ${pr.duration} min · niveau ${pr.level} · semaine ${programWeekNo(pr)}</p>
    ${can('pro') ? '' : lock('pro').replace('Fonction réservée', 'Programme de démarrage limité · ajustements réservés')}
    <div class="card"><h3>Échauffement</h3><ul class="tick">${pr.warmup.map(x => `<li>${x}</li>`).join('')}</ul></div>
    ${pr.week.map((day, i) => `<div class="card"><div class="row between"><h3 style="margin:0">${DOW[i]} — ${esc(day.name)}</h3>${day.rest ? '<span class="badge">Repos</span>' : `<a class="btn sm primary" href="#/session?d=${i}">Démarrer</a>`}</div>
      ${day.exercises.map((x, k) => { const e = EXMAP[x.exId]; return `<div class="ex"><div style="flex:1"><b>${esc(e.name)}</b> <span class="badge">${e.muscle}</span><br><small style="color:var(--muted)">${x.sets} × ${x.reps} · repos ${x.rest} s</small><br><small style="color:var(--muted)">💡 ${esc(x.tip)}</small></div>
        ${can('pro') ? `<div class="row"><button class="btn sm" data-act="exsets" data-d="${i}" data-k="${k}" aria-label="Ajouter une série à ${esc(e.name)}">+série</button><button class="btn sm danger" data-act="exdel" data-d="${i}" data-k="${k}" aria-label="Retirer ${esc(e.name)}">✕</button></div>` : ''}</div>`; }).join('')}</div>`).join('')}
    <div class="card"><h3>Retour au calme</h3><ul class="tick">${pr.cooldown.map(x => `<li>${x}</li>`).join('')}</ul></div>
    <div class="card"><h3>Progression</h3><p>${esc(pr.progression)}</p></div>`);
};
PAGES.session = () => {
  const d = U(), pr = d.program; const i = Number(params.get('d')); const day = pr && pr.week[i];
  if (!day || day.rest) return view('<div class="empty"><p>Pas de séance ce jour-là.</p><a class="btn" href="#/program">Retour</a></div>');
  if (!d.active || d.active.dayIdx !== i) {
    if (d.active && d.active.dayIdx !== i && !confirm('Une autre séance est en cours. L\'abandonner ?')) return goto('session?d=' + d.active.dayIdx);
    d.active = { dayIdx: i, name: day.name, startedAt: Date.now(), acc: 0, paused: false, items: day.exercises.map(x => ({ exId: x.exId, done: false, sets: Array.from({ length: x.sets }, () => ({ reps: '', kg: '', done: false })) })) }; save();
  }
  drawSession();
  timerId = setInterval(() => { const t0 = $('#timer'); if (t0 && d.active) t0.textContent = mmss(elapsed()); }, 1000);
};
const elapsed = () => { const a = U().active; return a.acc + (a.paused ? 0 : Date.now() - a.startedAt); };
function drawSession() {
  const d = U(), a = d.active, day = d.program.week[a.dayIdx];
  view(`<div class="row between"><h1>${esc(a.name)}</h1><div class="stat" id="timer" aria-live="off">${mmss(elapsed())}</div></div>
    <div class="row" style="margin-bottom:14px"><button class="btn" data-act="pause">${a.paused ? '▶ Reprendre' : '⏸ Pause'}</button><a class="btn" href="#/program">Quitter (séance conservée)</a><button class="btn danger" data-act="abandon">Abandonner</button></div>
    <p class="notice">Échauffe-toi 5 minutes. Arrête-toi en cas de douleur.</p>
    ${a.items.map((it, k) => { const e = EXMAP[it.exId], x = day.exercises[k]; return `<div class="card"><label class="check"><input type="checkbox" data-chg="exdone" data-k="${k}" ${it.done ? 'checked' : ''}> <span><b>${esc(e.name)}</b> — ${x.sets} × ${x.reps}, repos ${x.rest} s<br><small style="color:var(--muted)">${esc(e.desc)}</small></span></label>
      <div class="tablewrap"><table><tr><th>Série</th><th>${e.time ? 'Durée (s)' : 'Reps'}</th><th>Charge (kg)</th><th>Fait</th></tr>${it.sets.map((s, j) => `<tr><td>${j + 1}</td><td><input type="number" min="0" data-chg="setf" data-k="${k}" data-j="${j}" data-f="reps" value="${s.reps}" aria-label="Répétitions série ${j + 1}" style="min-height:36px"></td><td><input type="number" min="0" step="0.5" data-chg="setf" data-k="${k}" data-j="${j}" data-f="kg" value="${s.kg}" aria-label="Charge série ${j + 1}" style="min-height:36px"></td><td><input type="checkbox" data-chg="setdone" data-k="${k}" data-j="${j}" ${s.done ? 'checked' : ''} aria-label="Série ${j + 1} faite"></td></tr>`).join('')}</table></div></div>`; }).join('')}
    <form class="card" data-form="finish"><h3>Terminer</h3><div class="field"><label for="f-r">Difficulté ressentie (1 facile – 10 très dur)</label><select id="f-r" name="rpe">${[...Array(10)].map((_, i) => `<option ${i === 5 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
    <div class="field"><label for="f-n">Notes (facultatif)</label><textarea id="f-n" name="note"></textarea></div><button class="btn primary">Terminer la séance</button></form>`);
}
FORMS.finish = fd => {
  const d = U(), a = d.active; if (!a) return;
  const ms = elapsed();
  d.sessions.push({ id: uid(), date: new Date().toISOString(), dayIdx: a.dayIdx, name: a.name, durationMs: ms, rpe: Number(fd.get('rpe')), note: String(fd.get('note')).slice(0, 500), items: a.items });
  d.active = null; save();
  const ws = weekStart(), done = d.sessions.filter(s => new Date(s.date) >= ws).length, planned = d.program.week.filter(x => !x.rest).length;
  notify('system', `Séance « ${a.name} » terminée en ${Math.round(ms / 60000)} min.`);
  if (done >= planned) notify('weekly', 'Objectif hebdomadaire atteint, bravo !');
  toast('Séance enregistrée ✅'); goto('history');
};
PAGES.history = () => {
  const d = U(); const all = d.sessions.slice().reverse(); const list = can('pro') ? all : all.slice(0, 3);
  view(`<h1>Historique des séances</h1>${can('pro') || all.length <= 3 ? '' : lock('pro').replace('Fonction réservée', 'Historique complet réservé')}
    ${list.length ? list.map(s => `<div class="card"><div class="row between"><b>${esc(s.name)}</b><span>${fmtDate(s.date.slice(0, 10))}</span></div><p style="margin:6px 0">${Math.round(s.durationMs / 60000)} min · difficulté ${s.rpe}/10 · ${s.items.filter(i => i.done).length}/${s.items.length} exercices cochés</p>
    ${s.items.map(i => `<small style="color:var(--muted);display:block">${esc(EXMAP[i.exId].name)} : ${i.sets.filter(x => x.done).length}/${i.sets.length} séries${i.sets.some(x => x.reps) ? ' (' + i.sets.map(x => (x.reps || '–') + (x.kg ? '×' + x.kg + 'kg' : '')).join(', ') + ')' : ''}</small>`).join('')}${s.note ? `<p style="margin-top:8px">📝 ${esc(s.note)}</p>` : ''}</div>`).join('') : '<div class="empty">Aucune séance terminée pour l\'instant.</div>'}`);
};

/* ---------- Nutrition ---------- */
let MD = null; // brouillon de repas
PAGES.nutrition = () => {
  const d = U(), pr = d.profile; const meals = allowedMeals(); const tab = params.get('t') || 'ideas'; const tdy = isoDay();
  const todayLog = d.foodLog.filter(x => x.date === tdy); const tot = todayLog.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p }), { kcal: 0, p: 0 });
  const tabs = [['ideas', 'Idées'], ['menu', 'Menu'], ['shop', 'Courses'], ['log', 'Journal']];
  let body = '';
  if (tab === 'ideas') body = `<p>Repas compatibles avec ton budget (${['', 'serré', 'moyen', 'confortable'][pr.budget]}) et tes allergies${pr.allergies.length ? ' (' + pr.allergies.map(a => ALLERGENS[a]).join(', ') + ' exclus)' : ''}.</p>${EST_NOTE}<div class="grid g2">${meals.map(m => { const s = sumItems(m.items); return `<a class="card hover" style="text-decoration:none;color:inherit" href="#/meal?id=${m.id}"><span class="badge">${m.type}</span><h3 style="margin-top:8px">${esc(m.name)}</h3><p style="margin:0">≈ ${Math.round(s.kcal)} kcal · ${Math.round(s.p)} g protéines</p></a>`; }).join('') || '<div class="empty">Aucun repas compatible.</div>'}</div>`;
  if (tab === 'menu') {
    if (!can('pro')) body = lock('pro');
    else {
      const mu = d.menu || {}; const opts = (sel, type) => `<option value="">—</option>` + meals.filter(m => !type || type.includes(m.type)).map(m => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
      body = `<div class="row" style="margin-bottom:12px"><button class="btn sm primary" data-act="automenu">Générer un menu automatique</button><button class="btn sm danger" data-act="clearmenu">Vider</button></div><div class="card tablewrap"><table><tr><th>Jour</th><th>Matin</th><th>Midi</th><th>Soir</th></tr>
      ${DOW.map((n, i) => `<tr><td>${n.slice(0, 3)}</td>${['b', 'l', 'd'].map((slot, si) => `<td><select data-chg="menu" data-i="${i}" data-s="${slot}" aria-label="${n} ${['matin', 'midi', 'soir'][si]}">${opts((mu[i] || {})[slot], si === 0 ? ['Petit-déjeuner', 'Collation'] : si === 1 ? ['Déjeuner', 'Collation'] : ['Dîner', 'Déjeuner'])}</select></td>`).join('')}</tr>`).join('')}</table></div>`;
    }
  }
  if (tab === 'shop') {
    if (!can('pro')) body = lock('pro');
    else {
      const agg = {}; Object.values(d.menu || {}).forEach(day => ['b', 'l', 'd'].forEach(s => { const m = MMAP[day[s]]; if (m) m.items.forEach(([id, g]) => agg[id] = (agg[id] || 0) + g); }));
      const ids = Object.keys(agg);
      body = ids.length ? `<div class="card"><table><tr><th>Aliment</th><th>Quantité pour la semaine</th></tr>${ids.map(id => `<tr><td>${esc(FMAP[id].name)}</td><td>${agg[id] >= 1000 ? (agg[id] / 1000).toFixed(1) + ' kg' : agg[id] + ' g'}</td></tr>`).join('')}</table><p style="margin-top:10px"><button class="btn sm" data-act="copyshop">Copier la liste</button></p></div>` : '<div class="empty">Crée d\'abord un menu pour générer ta liste de courses.</div>';
      window.__shop = ids.map(id => `- ${FMAP[id].name} : ${agg[id]} g`).join('\n');
    }
  }
  if (tab === 'log') body = `<div class="card"><h3>Aujourd'hui</h3><p>≈ ${Math.round(tot.kcal)} kcal · ${Math.round(tot.p)} g protéines (estimations)</p>
    ${todayLog.map(x => `<div class="row between"><span>${esc(x.name)} — ≈ ${Math.round(x.kcal)} kcal</span><button class="btn sm danger" data-act="dellog" data-id="${x.id}" aria-label="Supprimer ${esc(x.name)}">✕</button></div>`).join('') || '<div class="empty">Aucun repas enregistré aujourd\'hui.</div>'}</div>
    <form class="card" data-form="customlog"><h3>Ajouter un repas libre</h3><div class="grid g2"><div class="field"><label for="cl-n">Nom</label><input id="cl-n" name="n" required></div><div class="field"><label for="cl-k">Calories estimées (facultatif)</label><input id="cl-k" name="k" type="number" min="0" max="5000"></div></div><button class="btn primary">Enregistrer</button></form>${EST_NOTE}`;
  view(`<h1>Nutrition</h1><div class="row" role="tablist" style="margin-bottom:14px">${tabs.map(([k, l]) => `<a class="btn sm ${tab === k ? 'primary' : ''}" href="#/nutrition?t=${k}">${l}</a>`).join('')}</div>${body}`);
};
PAGES.meal = () => {
  const m = MMAP[params.get('id')]; if (!m) return goto('nutrition');
  if (!MD || MD.id !== m.id) MD = { id: m.id, items: m.items.map(x => x.slice()) };
  drawMeal();
};
function drawMeal() {
  const m = MMAP[MD.id], s = sumItems(MD.items); const al = U().profile.allergies;
  view(`<a href="#/nutrition">← Nutrition</a><h1>${esc(m.name)}</h1><span class="badge">${m.type}</span>${EST_NOTE}
    <div class="card"><table><tr><th>Ingrédient</th><th>Portion (g)</th><th>Remplacer par</th></tr>${MD.items.map(([id, g], i) => `<tr><td>${esc(FMAP[id].name)}</td><td><input type="number" min="5" max="800" step="5" data-chg="mgram" data-i="${i}" value="${g}" style="min-height:36px;width:90px" aria-label="Grammes de ${esc(FMAP[id].name)}"></td>
      <td><select data-chg="msub" data-i="${i}" aria-label="Remplacer ${esc(FMAP[id].name)}"><option value="">—</option>${FOODS.filter(f => f.cat === FMAP[id].cat && f.id !== id && !al.includes(f.allergen)).map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></td></tr>`).join('')}</table>
    <p style="margin-top:12px"><b>≈ ${Math.round(s.kcal)} kcal</b> · ${Math.round(s.p)} g protéines · ${Math.round(s.c)} g glucides · ${Math.round(s.f)} g lipides</p><button class="btn primary" data-act="logmeal">Enregistrer dans mon journal</button></div>`);
}

/* ---------- Suivi des progrès ---------- */
PAGES.progress = () => {
  const d = U(); const ms = d.measures.slice().sort((a, b) => a.date.localeCompare(b.date));
  const w = ms.filter(m => m.weight).map(m => ({ d: m.date, v: m.weight })), wa = ms.filter(m => m.waist).map(m => ({ d: m.date, v: m.waist }));
  const pro = can('pro'); const dates = ms.map(m => m.date);
  const cmp = params.get('a') && params.get('b') ? [ms.find(m => m.id === params.get('a')), ms.find(m => m.id === params.get('b'))] : null;
  const diff = (f, u) => cmp && cmp[0] && cmp[1] && cmp[0][f] != null && cmp[1][f] != null ? `${cmp[0][f]} → ${cmp[1][f]} ${u} (${(cmp[1][f] - cmp[0][f] > 0 ? '+' : '') + (cmp[1][f] - cmp[0][f]).toFixed(1)})` : '—';
  view(`<h1>Suivi des progrès</h1>
    <form class="card" data-form="measure"><h3>Nouvelle mesure</h3><div class="grid g3"><div class="field"><label for="m-d">Date</label><input id="m-d" name="date" type="date" value="${isoDay()}" max="${isoDay()}" required></div>
    <div class="field"><label for="m-w">Poids (kg)</label><input id="m-w" name="weight" type="number" step="0.1" min="30" max="300"></div><div class="field"><label for="m-t">Tour de taille (cm)</label><input id="m-t" name="waist" type="number" step="0.1" min="40" max="250"></div>
    ${pro ? `<div class="field"><label for="m-h">Hanches (cm, facultatif)</label><input id="m-h" name="hips" type="number" step="0.1"></div><div class="field"><label for="m-c">Poitrine (cm, facultatif)</label><input id="m-c" name="chest" type="number" step="0.1"></div><div class="field"><label for="m-b">Bras (cm, facultatif)</label><input id="m-b" name="arm" type="number" step="0.1"></div>` : ''}</div>
    <div class="field"><label for="m-n">Notes personnelles</label><input id="m-n" name="note" maxlength="300"></div><div class="err" id="m-err" role="alert"></div><button class="btn primary">Enregistrer</button>${pro ? '' : '<small style="display:block;margin-top:8px;color:var(--muted)">Mensurations détaillées et photos : formule Pro.</small>'}</form>
    <div class="grid g2"><div class="card"><h3>Poids</h3>${lineChart(w, 'kg', 'Poids')}</div><div class="card"><h3>Tour de taille</h3>${lineChart(wa, 'cm', 'Tour de taille')}</div></div>
    <div class="card"><div class="row between"><h3 style="margin:0">Historique</h3><div class="row"><button class="btn sm" data-act="exportcsv">Exporter CSV</button><button class="btn sm danger" data-act="delmeasures">Tout supprimer</button></div></div>
    ${ms.length ? `<div class="tablewrap"><table><tr><th>Date</th><th>Poids</th><th>Taille</th><th>Autres</th><th>Notes</th><th></th></tr>${ms.slice().reverse().map(m => `<tr><td>${fmtDate(m.date)}</td><td>${m.weight ?? '—'}</td><td>${m.waist ?? '—'}</td><td>${[m.hips && 'H ' + m.hips, m.chest && 'P ' + m.chest, m.arm && 'B ' + m.arm].filter(Boolean).join(' · ') || '—'}</td><td>${esc(m.note || '')}</td><td><button class="btn sm danger" data-act="delm" data-id="${m.id}" aria-label="Supprimer la mesure du ${m.date}">✕</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Aucune mesure enregistrée.</div>'}</div>
    ${ms.length >= 2 ? `<form class="card" data-form="compare"><h3>Comparer deux dates</h3><div class="row"><select name="a" aria-label="Date de départ">${ms.map(m => `<option value="${m.id}" ${params.get('a') === m.id ? 'selected' : ''}>${fmtDate(m.date)}</option>`).join('')}</select><select name="b" aria-label="Date d'arrivée">${ms.map((m, i) => `<option value="${m.id}" ${params.get('b') === m.id || (!params.get('b') && i === ms.length - 1) ? 'selected' : ''}>${fmtDate(m.date)}</option>`).join('')}</select><button class="btn">Comparer</button></div>
    ${cmp ? `<p style="margin-top:10px">Poids : ${diff('weight', 'kg')}<br>Tour de taille : ${diff('waist', 'cm')}</p>` : ''}</form>` : ''}
    <div class="card"><h3>Photos de progression (privées)</h3>${pro ? `<p class="notice">Enregistrées uniquement dans ce navigateur, jamais envoyées, jamais utilisées pour entraîner une IA, jamais modifiées.</p>
    <div class="row"><input type="file" id="photo" accept="image/jpeg,image/png,image/webp" aria-label="Ajouter une photo" style="max-width:320px"></div>
    <div class="grid g3" style="margin-top:12px">${d.photos.slice().reverse().map(p => `<figure style="margin:0"><img src="${p.data}" alt="Photo du ${p.date}" style="width:100%;border-radius:12px"><figcaption class="row between" style="font-size:.85rem">${fmtDate(p.date)}<button class="btn sm danger" data-act="delphoto" data-id="${p.id}" aria-label="Supprimer la photo du ${p.date}">✕</button></figcaption></figure>`).join('') || '<div class="empty">Aucune photo.</div>'}</div>` : lock('pro')}</div>`);
  const ph = $('#photo'); if (ph) ph.addEventListener('change', onPhoto);
};
FORMS.measure = fd => {
  const o = { id: uid(), date: String(fd.get('date')) }; const err = $('#m-err');
  ['weight', 'waist', 'hips', 'chest', 'arm'].forEach(k => { const v = fd.get(k); if (v !== null && v !== '') o[k] = Number(v); });
  if (!o.date || o.date > isoDay()) return err.textContent = 'Date invalide.';
  if (o.weight == null && o.waist == null && o.hips == null && o.chest == null && o.arm == null) return err.textContent = 'Saisissez au moins une mesure.';
  if (o.weight != null && !(o.weight >= 30 && o.weight <= 300)) return err.textContent = 'Poids entre 30 et 300 kg.';
  if (o.waist != null && !(o.waist >= 40 && o.waist <= 250)) return err.textContent = 'Tour de taille entre 40 et 250 cm.';
  if (fd.get('note')) o.note = String(fd.get('note')).slice(0, 300);
  U().measures.push(o); save(); toast('Mesure enregistrée'); route();
};
FORMS.compare = fd => goto(`progress?a=${fd.get('a')}&b=${fd.get('b')}`);
function onPhoto(e) {
  const f = e.target.files[0]; if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 8e6) return toast('Image JPEG/PNG/WebP de 8 Mo maximum.', true);
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const sc = Math.min(1, 640 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    U().photos.push({ id: uid(), date: isoDay(), data: c.toDataURL('image/jpeg', 0.75) }); if (save()) { toast('Photo ajoutée (privée)'); route(); } else U().photos.pop();
  };
  img.onerror = () => toast('Image illisible.', true); img.src = url;
}

/* ---------- Coach ---------- */
PAGES.coach = () => {
  const d = U();
  view(`<h1>Coach IA</h1><p class="notice">${d.settings.aiEndpoint ? 'Service IA serveur connecté (avec réponse de secours locale).' : 'Mode <b>coach local</b> : réponses par règles (exercices, alternatives, séance, progrès, routine). Pour une IA conversationnelle, configurez un point d\'accès serveur dans Paramètres.'} Il ne remplace pas un professionnel de santé. Messages restants aujourd'hui : <b id="rem">${aiRemaining()}</b>/${AI_LIMIT()}.</p>
    <div class="card"><div class="chat" id="chat" aria-live="polite">${d.chat.length ? d.chat.map(m => `<div class="msg ${m.r}">${esc(m.t)}</div>`).join('') : '<div class="empty">Pose ta première question 👇</div>'}</div>
    <div class="row" style="margin:12px 0">${['Séance du jour', 'Résumé de mes progrès', 'Comment faire des squats ?', 'Alternative aux pompes', 'Conseils de routine'].map(q => `<button class="btn sm" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form data-form="chat" class="row" style="flex-wrap:nowrap"><label for="q" style="position:absolute;left:-999px">Message</label><input id="q" name="q" maxlength="500" placeholder="Ta question…" autocomplete="off" required><button class="btn primary">Envoyer</button></form>
    <button class="btn sm danger" style="margin-top:10px" data-act="clearchat">Effacer la conversation</button></div>`);
  const c = $('#chat'); c.scrollTop = c.scrollHeight;
};
async function sendChat(q) {
  q = q.trim().slice(0, 500); if (!q) return; const d = U();
  d.chat.push({ r: 'u', t: q }); const c = $('#chat'); if (c) { c.insertAdjacentHTML('beforeend', `<div class="msg u">${esc(q)}</div><div class="msg a" id="typing">…</div>`); c.scrollTop = c.scrollHeight; }
  const r = await askCoach(q); d.chat.push({ r: 'a', t: r.text }); d.chat = d.chat.slice(-40); save();
  if (me() && location.hash.startsWith('#/coach')) { const t = $('#typing'); if (t) { t.removeAttribute('id'); t.textContent = r.text; } const rem = $('#rem'); if (rem) rem.textContent = aiRemaining(); if (c) c.scrollTop = c.scrollHeight; }
}
FORMS.chat = (fd, f) => { const q = String(fd.get('q')); f.reset(); sendChat(q); };

/* ---------- Notifications ---------- */
PAGES.notifications = () => {
  const d = U(), n = d.settings.notif; d.notifs.forEach(x => x.read = true); save();
  const T = [['reminders', 'Rappels d\'entraînement'], ['weekly', 'Objectifs hebdomadaires'], ['review', 'Bilans de progression'], ['renewal', 'Renouvellements d\'abonnement'], ['payfail', 'Échecs de paiement'], ['marketing', 'Messages marketing (désactivé par défaut)']];
  view(`<h1>Notifications</h1><form class="card" data-form="notif"><h3>Préférences</h3>${T.map(([k, l]) => `<label class="check field"><input type="checkbox" name="${k}" ${n[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    <div class="field"><label for="nt">Heure du rappel</label><input id="nt" type="time" name="remindTime" value="${n.remindTime}" style="max-width:160px"></div>
    <div class="row"><button class="btn primary">Enregistrer</button><button type="button" class="btn" data-act="allownotif">Autoriser les alertes du navigateur</button></div>
    <p style="margin-top:10px;font-size:.85rem">Les rappels s'affichent tant que l'application est ouverte. Les notifications push application fermée nécessitent un serveur.</p></form>
    <div class="card"><div class="row between"><h3 style="margin:0">Récentes</h3><button class="btn sm danger" data-act="clearnotifs">Effacer</button></div>${d.notifs.map(x => `<p style="margin:8px 0">🔔 ${esc(x.text)} <small style="color:var(--muted)">· ${fmtDate(x.date.slice(0, 10))}</small></p>`).join('') || '<div class="empty">Aucune notification.</div>'}</div>`);
};
FORMS.notif = fd => {
  const n = U().settings.notif; ['reminders', 'weekly', 'review', 'renewal', 'payfail', 'marketing'].forEach(k => n[k] = !!fd.get(k)); n.remindTime = String(fd.get('remindTime') || '18:00'); save(); toast('Préférences enregistrées');
};
let lastRemind = '';
setInterval(() => {
  if (!me() || !U().profile) return; const n = U().settings.notif; if (!n.reminders) return;
  const now = new Date(), hm = pad(now.getHours()) + ':' + pad(now.getMinutes()), key = isoDay() + hm;
  if (hm === n.remindTime && lastRemind !== key) {
    const day = U().program && U().program.week[dowIdx()]; if (day && !day.rest && !U().sessions.some(s => s.date.slice(0, 10) === isoDay())) {
      lastRemind = key; notify('reminders', `C'est l'heure de ta séance : ${day.name}.`);
      if (window.Notification && Notification.permission === 'granted') new Notification(CONFIG.appName, { body: `C'est l'heure de ta séance : ${day.name}.` });
    }
  }
}, 20000);

/* ---------- Abonnement ---------- */
PAGES.subscription = () => {
  const d = U(), cur = d.settings.currency, period = params.get('p') === 'year' ? 'year' : 'month'; const pl = plan();
  view(`<h1>Gestion de l'abonnement</h1><div class="card"><p>Formule actuelle : <span class="badge">${CONFIG.plans[pl].name}</span>${d.planUntil ? ` jusqu'au ${fmtDate(isoDay(new Date(d.planUntil)))}` : ''}</p>${pl !== 'free' ? '<button class="btn sm danger" data-act="cancelplan">Annuler et repasser en Free</button>' : ''}</div>
    <div class="row between" style="margin-bottom:12px"><div class="row"><a class="btn sm ${period === 'month' ? 'primary' : ''}" href="#/subscription?p=month">Mensuel</a><a class="btn sm ${period === 'year' ? 'primary' : ''}" href="#/subscription?p=year">Annuel (−${Math.round(CONFIG.annualDiscount * 100)} %)</a></div>
    <div class="cur" role="group" aria-label="Devise">${['XOF', 'EUR', 'USD'].map(c => `<button data-act="cur" data-v="${c}" aria-pressed="${cur === c}">${c === 'XOF' ? 'FCFA' : c}</button>`).join('')}</div></div>
    <div class="grid g3">${['pro', 'elite'].map(k => `<div class="card"><h3>${CONFIG.plans[k].name}</h3><div class="price">${money(priceOf(k, period))}<small> /${period === 'year' ? 'an' : 'mois'}</small></div>
      ${pl === k ? '<span class="badge">Formule actuelle</span>' : `<button class="btn primary" data-act="checkout" data-p="${k}" data-per="${period}">${CONFIG.checkoutEndpoint ? 'Payer (Mobile Money / carte)' : 'Activer en MODE TEST'}</button>`}</div>`).join('')}</div>
    ${CONFIG.checkoutEndpoint ? '<p class="notice">Le paiement est traité par votre prestataire. La formule n\'est activée qu\'après confirmation serveur (webhook vérifié).</p>' : '<p class="notice warn"><b>MODE TEST</b> : aucun paiement réel n\'est effectué. Le paiement réel (Mobile Money, carte, EUR, USD), les webhooks signés et l\'anti-doublon nécessitent un serveur : renseignez <code>CONFIG.checkoutEndpoint</code> et <code>CONFIG.statusEndpoint</code> dans script.js. Ne pas utiliser en production.</p>'}
    <div class="card"><h3>Transactions</h3>${d.transactions.length ? `<div class="tablewrap"><table><tr><th>Date</th><th>Formule</th><th>Montant</th><th>Statut</th></tr>${d.transactions.slice().reverse().map(x => `<tr><td>${fmtDate(x.date.slice(0, 10))}</td><td>${CONFIG.plans[x.plan].name} (${x.period === 'year' ? 'annuel' : 'mensuel'})</td><td>${money(x.xof, x.cur)}</td><td>${x.status === 'test' ? '<span class="badge warn">TEST</span>' : esc(x.status)}</td></tr>`).join('')}</table></div>` : '<div class="empty">Aucune transaction.</div>'}</div>`);
};

/* ---------- Paramètres ---------- */
PAGES.settings = () => {
  const d = U();
  view(`<h1>Paramètres</h1>
    <div class="card"><h3>Profil</h3><p>${esc(me().name)} · ${esc(me().email)}</p><a class="btn sm" href="#/onboarding" data-act="redo">Modifier mes réponses du questionnaire</a></div>
    <form class="card" data-form="prefs"><h3>Préférences</h3><div class="grid g2"><div class="field"><label for="p-c">Devise</label><select id="p-c" name="cur">${[['XOF', 'FCFA'], ['EUR', 'EUR'], ['USD', 'USD']].map(([v, l]) => `<option value="${v}" ${d.settings.currency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="p-l">Langue</label><select id="p-l" name="lang"><option value="fr" ${lang() === 'fr' ? 'selected' : ''}>Français</option><option value="en" ${lang() === 'en' ? 'selected' : ''}>English (partiel)</option></select></div></div>
    <div class="field"><label for="p-a">Point d'accès IA serveur (facultatif, HTTPS)</label><input id="p-a" name="ep" type="url" placeholder="https://votre-serveur/api/coach" value="${esc(d.settings.aiEndpoint)}"><small style="color:var(--muted)">Votre serveur doit appeler le fournisseur IA avec sa clé secrète (jamais dans ce fichier) et renvoyer { "reply": "…" }.</small></div><button class="btn primary">Enregistrer</button></form>
    <form class="card" data-form="pw"><h3>Changer le mot de passe</h3><div class="grid g2"><div class="field"><label for="w-o">Ancien</label><input id="w-o" name="o" type="password" autocomplete="current-password" required></div><div class="field"><label for="w-n">Nouveau (8 car. min.)</label><input id="w-n" name="n" type="password" autocomplete="new-password" minlength="8" required></div></div><div class="err" id="w-err" role="alert"></div><button class="btn">Modifier</button></form>
    <div class="card"><h3>Mes données</h3><div class="row"><button class="btn" data-act="exportdata">Exporter mes données (JSON)</button><button class="btn danger" data-act="delphotos">Supprimer mes photos</button><button class="btn danger" data-act="deldata">Réinitialiser mes données</button><button class="btn danger" data-act="delaccount">Supprimer mon compte</button></div></div>`);
};
FORMS.prefs = fd => { const d = U(); d.settings.currency = String(fd.get('cur')); const ep = String(fd.get('ep')).trim(); if (ep && !/^https:\/\//.test(ep)) return toast('Le point d\'accès doit commencer par https://', true); d.settings.aiEndpoint = ep; DB.lang = String(fd.get('lang')); save(); toast('Enregistré'); route(); };
FORMS.pw = async fd => {
  const u = me(), err = $('#w-err'); const n = String(fd.get('n'));
  try { if ((await hashPw(String(fd.get('o')), u.salt)) !== u.hash) return err.textContent = 'Ancien mot de passe incorrect.'; if (n.length < 8) return err.textContent = '8 caractères minimum.'; u.salt = rndSalt(); u.hash = await hashPw(n, u.salt); save(); toast('Mot de passe modifié'); $('form[data-form=pw]').reset(); err.textContent = ''; } catch (e) { err.textContent = e.message; }
};

/* ---------- Actions (clics) ---------- */
const ACT = {
  logout() { DB.session = null; save(); OB = null; toast('Déconnecté'); goto('home'); },
  lang(el) { DB.lang = el.dataset.v; save(); route(); },
  cur(el) { if (me()) { U().settings.currency = el.dataset.v; save(); } else DB.cur = el.dataset.v; save(); route(); },
  exinfo(el, e) { e.preventDefault(); const x = EXMAP[el.dataset.id]; $('#exinfo').innerHTML = `<div class="card"><h3>${esc(x.name)}</h3><p>${esc(x.desc)}</p><p><b>Sécurité :</b> ${esc(x.safety)}</p><p><b>Variantes :</b> ${esc(x.variants)}</p></div>`; },
  obpick(el) { obCollect(); OB.d[el.dataset.k] = el.dataset.v; drawOB(); },
  obprev() { obCollect(); OB.step = Math.max(0, OB.step - 1); drawOB(); },
  obgo(el) { OB.step = Number(el.dataset.s); drawOB(); },
  obnext() { obCollect(); const e = obValid(OB.step); if (e) return $('#ob-err').textContent = e; if (OB.step === 5) { for (let s = 0; s < 5; s++) { const er = obValid(s); if (er) { OB.step = s; drawOB(); return $('#ob-err').textContent = er; } } obFinish(); } else { OB.step++; drawOB(); } },
  redo() { OB = null; },
  exdel(el) { const d = U(), day = d.program.week[el.dataset.d]; if (day.exercises.length <= 1) return toast('Gardez au moins un exercice (ou régénérez).', true); day.exercises.splice(el.dataset.k, 1); save(); route(); },
  exsets(el) { const x = U().program.week[el.dataset.d].exercises[el.dataset.k]; if (x.sets >= 8) return toast('8 séries maximum.', true); x.sets++; save(); route(); },
  pause() { const a = U().active; if (a.paused) { a.startedAt = Date.now(); a.paused = false; } else { a.acc += Date.now() - a.startedAt; a.paused = true; } save(); drawSession(); },
  abandon() { if (confirm('Abandonner cette séance ? Les données saisies seront perdues.')) { U().active = null; save(); goto('program'); } },
  automenu() { const m = allowedMeals(); if (!m.length) return toast('Aucun repas compatible.', true); const by = t => m.filter(x => t.includes(x.type)); const B = by(['Petit-déjeuner']), L = by(['Déjeuner']), D = by(['Dîner', 'Déjeuner']); const pick = (a, i) => a.length ? a[i % a.length].id : ''; U().menu = {}; for (let i = 0; i < 7; i++) U().menu[i] = { b: pick(B, i), l: pick(L, i), d: pick(D, i + 1) }; save(); route(); },
  clearmenu() { U().menu = null; save(); route(); },
  copyshop() { navigator.clipboard && navigator.clipboard.writeText(window.__shop || '').then(() => toast('Liste copiée'), () => toast('Copie impossible', true)); },
  logmeal() { const s = sumItems(MD.items), m = MMAP[MD.id]; U().foodLog.push({ id: uid(), date: isoDay(), name: m.name, kcal: s.kcal, p: s.p }); save(); toast('Repas enregistré'); goto('nutrition?t=log'); },
  dellog(el) { const d = U(); d.foodLog = d.foodLog.filter(x => x.id !== el.dataset.id); save(); route(); },
  delm(el) { const d = U(); d.measures = d.measures.filter(x => x.id !== el.dataset.id); save(); route(); },
  delmeasures() { if (confirm('Supprimer toutes les mesures ?')) { U().measures = []; save(); route(); } },
  delphoto(el) { if (confirm('Supprimer cette photo ?')) { const d = U(); d.photos = d.photos.filter(x => x.id !== el.dataset.id); save(); route(); } },
  delphotos() { if (confirm('Supprimer toutes vos photos ?')) { U().photos = []; save(); toast('Photos supprimées'); } },
  exportcsv() { const rows = [['date', 'poids_kg', 'tour_de_taille_cm', 'hanches_cm', 'poitrine_cm', 'bras_cm', 'notes']].concat(U().measures.slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => [m.date, m.weight ?? '', m.waist ?? '', m.hips ?? '', m.chest ?? '', m.arm ?? '', '"' + String(m.note || '').replace(/"/g, '""') + '"'])); dl('mesures.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv'); },
  exportdata() { const d = JSON.parse(JSON.stringify(U())); d.photos = d.photos.map(p => ({ id: p.id, date: p.date, data: p.data })); dl('mes-donnees-bodytransformation.json', JSON.stringify({ name: me().name, email: me().email, exportedAt: new Date().toISOString(), data: d }, null, 2), 'application/json'); },
  deldata() { if (confirm('Réinitialiser programme, séances, mesures, photos et journal ?')) { const u = me(); const s = u.data.settings, pl = { plan: u.data.plan, planUntil: u.data.planUntil, transactions: u.data.transactions }; u.data = Object.assign(newData(), pl); u.data.settings = s; save(); OB = null; toast('Données réinitialisées'); goto('onboarding'); } },
  delaccount() { if (confirm('Supprimer définitivement votre compte et toutes vos données de ce navigateur ?')) { delete DB.users[DB.session]; DB.session = null; save(); toast('Compte supprimé'); goto('home'); } },
  ask(el) { sendChat(el.dataset.q); },
  clearchat() { U().chat = []; save(); route(); },
  allownotif() { if (!window.Notification) return toast('Non pris en charge par ce navigateur.', true); Notification.requestPermission().then(p => toast(p === 'granted' ? 'Alertes autorisées' : 'Alertes refusées', p !== 'granted')); },
  clearnotifs() { U().notifs = []; save(); route(); },
  cancelplan() { if (confirm('Repasser à la formule Free ?')) { const d = U(); d.plan = 'free'; d.planUntil = null; d.transactions.push({ id: uid(), date: new Date().toISOString(), plan: 'free', period: 'month', xof: 0, cur: 'XOF', status: 'annulé' }); save(); notify('renewal', 'Abonnement annulé. Retour à la formule Free.'); route(); } },
  async checkout(el) {
    const d = U(), k = el.dataset.p, per = el.dataset.per, xof = priceOf(k, per), cur = d.settings.currency;
    if (CONFIG.checkoutEndpoint) {
      el.disabled = true;
      try { const r = await fetch(CONFIG.checkoutEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: me().email, plan: k, period: per, currency: cur }) }); const j = await r.json(); if (j && typeof j.url === 'string' && /^https:\/\//.test(j.url)) { location.href = j.url; return; } throw new Error(); }
      catch (e) { el.disabled = false; toast('Impossible de créer la commande de paiement.', true); notify('payfail', 'La création de la commande de paiement a échoué.'); }
      return;
    }
    if (!confirm('MODE TEST : aucun paiement réel. Activer la formule ' + CONFIG.plans[k].name + ' pour 30 jours / 1 an ?')) return;
    d.plan = k; d.planUntil = Date.now() + (per === 'year' ? 365 : 30) * 864e5; d.transactions.push({ id: uid(), date: new Date().toISOString(), plan: k, period: per, xof, cur, status: 'test' });
    save(); notify('renewal', `Formule ${CONFIG.plans[k].name} activée en mode test.`); toast('Formule activée (TEST)'); route();
  }
};
function dl(name, txt, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e); });
document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (f && FORMS[f.dataset.form]) { e.preventDefault(); FORMS[f.dataset.form](new FormData(f), f); } });
const CHG = {
  exdone(el) { const a = U().active; a.items[el.dataset.k].done = el.checked; if (el.checked) a.items[el.dataset.k].sets.forEach(s => s.done = true); save(); drawSession(); },
  setf(el) { const s = U().active.items[el.dataset.k].sets[el.dataset.j]; s[el.dataset.f] = el.value === '' ? '' : Math.max(0, Number(el.value)); save(); },
  setdone(el) { const it = U().active.items[el.dataset.k]; it.sets[el.dataset.j].done = el.checked; it.done = it.sets.every(s => s.done); save(); drawSession(); },
  menu(el) { const d = U(); d.menu = d.menu || {}; d.menu[el.dataset.i] = d.menu[el.dataset.i] || {}; d.menu[el.dataset.i][el.dataset.s] = el.value; save(); },
  mgram(el) { MD.items[el.dataset.i][1] = clamp(Number(el.value) || 5, 5, 800); drawMeal(); },
  msub(el) { if (el.value) { MD.items[el.dataset.i][0] = el.value; drawMeal(); } }
};
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el); });

/* ---------- Démarrage ---------- */
if (!location.hash) location.hash = '#/home';
route();
