import { settings, type Lang } from './settings';

type Dict = Record<string, string>;

const en: Dict = {
  'title.tag': 'A co-op heist for 2–4',
  'menu.name': 'Callsign',
  'menu.name.ph': 'Your name',
  'menu.create': 'Create crew',
  'menu.join': 'Join crew',
  'menu.joinCode': 'Join crew {code}',
  'menu.code.ph': 'CODE',
  'menu.settings': 'Settings',
  'menu.back': 'Back',
  'menu.resume': 'Resume',
  'menu.leave': 'Leave crew',
  'menu.invite': 'Copy invite link',
  'menu.invite.done': 'Invite link copied',
  'menu.paused': 'Paused',
  'menu.clickToPlay': 'Click to continue',
  'menu.build': 'Build {v} · foundation slice',
  'menu.connecting': 'Connecting…',
  'menu.color': 'Suit colour',

  'set.language': 'Language',
  'set.quality': 'Graphics',
  'set.q.auto': 'Auto',
  'set.q.low': 'Low',
  'set.q.medium': 'Medium',
  'set.q.high': 'High',
  'set.q.ultra': 'Ultra',
  'set.sensitivity': 'Mouse sensitivity',
  'set.fov': 'Field of view',
  'set.invertY': 'Invert vertical look',
  'set.master': 'Master volume',
  'set.sfx': 'Effects',
  'set.music': 'Music & ambience',
  'set.voice': 'Voice chat volume',
  'set.voiceMode': 'Microphone',
  'set.vm.open': 'Open mic',
  'set.vm.ptt': 'Push to talk (V)',
  'set.showFps': 'Show FPS',
  'set.on': 'On',
  'set.off': 'Off',

  'hud.code': 'CREW CODE',
  'hud.crew': 'CREW',
  'hud.you': 'you',
  'hud.host': 'host',
  'hud.objective': 'OBJECTIVE',
  'hud.mic.on': 'Mic live',
  'hud.mic.muted': 'Mic muted',
  'hud.mic.off': 'No microphone',
  'hud.mic.ptt': 'Hold V to talk',
  'hud.controls':
    'WASD move · Shift sprint · Space jump · C crouch · E use · F flashlight · M mute · Tab crew · Esc menu',

  'toast.joined': '{name} joined the crew',
  'toast.left': '{name} left the crew',
  'toast.hostLost': 'Connection to the host was lost',
  'toast.reconnecting': 'Connection lost — reconnecting…',
  'toast.reconnected': 'Reconnected',
  'toast.offline': 'Could not reach the matchmaking server. Playing offline — friends cannot join this session.',
  'toast.micDenied': 'Microphone blocked. You can still hear the crew.',
  'toast.full': 'This crew is full (4 players)',
  'toast.notFound': 'No crew found with code {code}',
  'toast.version': 'The host runs a different game version. Reload the page (Ctrl/Cmd + Shift + R).',
  'toast.quality': 'Graphics set to {q} to keep the frame rate smooth',

  'err.webgl': 'This browser cannot run the game (WebGL 2 is missing). Try a current Chrome, Edge or Firefox.',

  'prompt.relay': 'Hold to power the decoder',
  'prompt.relay.held': 'Decoder powered — keep holding',
  'prompt.key': 'Press {k}',
  'prompt.clear': 'Clear entry',
  'prompt.kit': 'Take the comms kit',
  'prompt.board': 'Review the job',
  'prompt.custodian': 'Inspect',
  'prompt.locked': 'Locked',

  'obj.relay': 'Power up the decoder: someone has to hold the relay in the power closet',
  'obj.read': 'Read the four coloured digits on the decoder screen',
  'obj.enter': 'Enter the digits at the practice vault in the order shown beside the keypad',
  'obj.kit': 'Take the comms kit from the practice vault',
  'obj.board': 'Go to the job board',
  'obj.done': 'Crew ready. First job arrives with the next build.',

  'sub.intro1': 'BROKER: Good. You found the place. Before I trust you with the real job, show me you can work as a crew.',
  'sub.intro2': 'BROKER: The practice vault on the west wall is wired like the real thing. Power, decoder, keypad. Nobody opens it alone. Well. Almost nobody.',
  'sub.power': 'BROKER: Decoder is live. Read it out before the power drops.',
  'sub.wrong': 'BROKER: Wrong sequence. The colours tell you the order.',
  'sub.reroll': 'BROKER: Three strikes. It scrambled the code. Start over.',
  'sub.open': 'BROKER: There it is. Grab the comms kit.',
  'sub.kit': 'BROKER: You are on my channel now. The board is yours… and ignore the unit in the corner. It came with the building. It is switched off.',
  'sub.dark': 'BROKER: …That was just the breaker. Probably.',
  'sub.custodian': 'A decommissioned Custodian unit. The eyes are dark. The dust on its shoulders has been disturbed.',

  'board.title': 'THE MERIDIAN JOB',
  'board.sub': 'Deep storage vault · 90 m below Meridian Tower',
  'board.locked': 'LOCKED — finish crew check',
  'board.soon': 'NEXT BUILD',
  'board.prep': 'PREP',
  'board.finale': 'FINALE',
  'board.reward': 'Unlocks',
  'm1.name': 'The Architect',
  'm1.desc': 'Break into the designer\'s office and steal the vault blueprints.',
  'm1.reward': 'Blueprints',
  'm2.name': 'Dead Signal',
  'm2.desc': 'Climb the relay tower and hijack the security uplink.',
  'm2.reward': 'Camera spoofer',
  'm3.name': 'Cold Start',
  'm3.desc': 'Lift the getaway car from an automated garage.',
  'm3.reward': 'Getaway vehicle',
  'm4.name': 'Live Fire',
  'm4.desc': 'Raid a contractor\'s test range. The drones shoot back.',
  'm4.reward': 'EMP gear',
  'm5.name': 'Glass House',
  'm5.desc': 'Slip through a laser-wired penthouse and clone a keycard.',
  'm5.reward': 'Access cards',
  'm6.name': 'Undercurrent',
  'm6.desc': 'Reroute the grid from the service tunnels. Bring a flashlight.',
  'm6.reward': 'Blackout charge',
  'm7.name': 'Null Vault',
  'm7.desc': 'The job itself. Five stages. Whatever is in Vault Ø, leave it there.',
  'm7.reward': 'The take',

  'decoder.nopower': 'NO POWER',
  'decoder.title': 'DECODER',
  'legend.title': 'ENTRY ORDER',
  'vault.label': 'PRACTICE VAULT',
  'closet.label': 'POWER',
  'c.red': 'RED',
  'c.blue': 'BLUE',
  'c.green': 'GREEN',
  'c.yellow': 'YELLOW',
};

const de: Dict = {
  'title.tag': 'Ein Koop-Heist für 2–4',
  'menu.name': 'Rufname',
  'menu.name.ph': 'Dein Name',
  'menu.create': 'Crew erstellen',
  'menu.join': 'Crew beitreten',
  'menu.joinCode': 'Crew {code} beitreten',
  'menu.code.ph': 'CODE',
  'menu.settings': 'Einstellungen',
  'menu.back': 'Zurück',
  'menu.resume': 'Weiter',
  'menu.leave': 'Crew verlassen',
  'menu.invite': 'Einladungslink kopieren',
  'menu.invite.done': 'Einladungslink kopiert',
  'menu.paused': 'Pause',
  'menu.clickToPlay': 'Klicken zum Fortsetzen',
  'menu.build': 'Build {v} · Fundament-Slice',
  'menu.connecting': 'Verbinde…',
  'menu.color': 'Anzugfarbe',

  'set.language': 'Sprache',
  'set.quality': 'Grafik',
  'set.q.auto': 'Auto',
  'set.q.low': 'Niedrig',
  'set.q.medium': 'Mittel',
  'set.q.high': 'Hoch',
  'set.q.ultra': 'Ultra',
  'set.sensitivity': 'Mausempfindlichkeit',
  'set.fov': 'Sichtfeld',
  'set.invertY': 'Vertikale Achse umkehren',
  'set.master': 'Gesamtlautstärke',
  'set.sfx': 'Effekte',
  'set.music': 'Musik & Atmosphäre',
  'set.voice': 'Lautstärke Sprachchat',
  'set.voiceMode': 'Mikrofon',
  'set.vm.open': 'Dauerhaft an',
  'set.vm.ptt': 'Push-to-Talk (V)',
  'set.showFps': 'FPS anzeigen',
  'set.on': 'An',
  'set.off': 'Aus',

  'hud.code': 'CREW-CODE',
  'hud.crew': 'CREW',
  'hud.you': 'du',
  'hud.host': 'Host',
  'hud.objective': 'ZIEL',
  'hud.mic.on': 'Mikro an',
  'hud.mic.muted': 'Mikro stumm',
  'hud.mic.off': 'Kein Mikrofon',
  'hud.mic.ptt': 'V halten zum Sprechen',
  'hud.controls':
    'WASD bewegen · Shift sprinten · Leertaste springen · C ducken · E benutzen · F Taschenlampe · M stumm · Tab Crew · Esc Menü',

  'toast.joined': '{name} ist der Crew beigetreten',
  'toast.left': '{name} hat die Crew verlassen',
  'toast.hostLost': 'Verbindung zum Host verloren',
  'toast.reconnecting': 'Verbindung verloren — verbinde neu…',
  'toast.reconnected': 'Wieder verbunden',
  'toast.offline': 'Matchmaking-Server nicht erreichbar. Du spielst offline — Freunde können dieser Sitzung nicht beitreten.',
  'toast.micDenied': 'Mikrofon blockiert. Du hörst die Crew trotzdem.',
  'toast.full': 'Diese Crew ist voll (4 Spieler)',
  'toast.notFound': 'Keine Crew mit dem Code {code} gefunden',
  'toast.version': 'Der Host nutzt eine andere Spielversion. Seite neu laden (Strg/Cmd + Shift + R).',
  'toast.quality': 'Grafik auf {q} gestellt, damit das Spiel flüssig läuft',

  'err.webgl': 'Dieser Browser kann das Spiel nicht starten (WebGL 2 fehlt). Nimm ein aktuelles Chrome, Edge oder Firefox.',

  'prompt.relay': 'Halten: Decoder mit Strom versorgen',
  'prompt.relay.held': 'Decoder hat Strom — weiter halten',
  'prompt.key': '{k} drücken',
  'prompt.clear': 'Eingabe löschen',
  'prompt.kit': 'Funk-Kit nehmen',
  'prompt.board': 'Job ansehen',
  'prompt.custodian': 'Untersuchen',
  'prompt.locked': 'Gesperrt',

  'obj.relay': 'Decoder mit Strom versorgen: Jemand muss das Relais in der Stromkammer halten',
  'obj.read': 'Die vier farbigen Ziffern auf dem Decoder-Bildschirm ablesen',
  'obj.enter': 'Ziffern am Übungstresor eingeben — in der Reihenfolge, die neben dem Tastenfeld steht',
  'obj.kit': 'Funk-Kit aus dem Übungstresor nehmen',
  'obj.board': 'Zur Job-Tafel gehen',
  'obj.done': 'Crew bereit. Der erste Job kommt mit dem nächsten Build.',

  'sub.intro1': 'BROKER: Gut. Ihr habt den Laden gefunden. Bevor ich euch den echten Job gebe, zeigt mir, dass ihr als Crew funktioniert.',
  'sub.intro2': 'BROKER: Der Übungstresor an der Westwand ist verkabelt wie das Original. Strom, Decoder, Tastenfeld. Den öffnet keiner allein. Na ja. Fast keiner.',
  'sub.power': 'BROKER: Decoder läuft. Lest die Ziffern durch, bevor der Strom weg ist.',
  'sub.wrong': 'BROKER: Falsche Reihenfolge. Die Farben sagen euch, wie.',
  'sub.reroll': 'BROKER: Drei Fehler. Der Code wurde neu gewürfelt. Von vorn.',
  'sub.open': 'BROKER: Na also. Holt euch das Funk-Kit.',
  'sub.kit': 'BROKER: Ihr seid jetzt auf meinem Kanal. Die Tafel gehört euch… und ignoriert die Einheit in der Ecke. Die war schon im Gebäude. Sie ist abgeschaltet.',
  'sub.dark': 'BROKER: …Das war nur die Sicherung. Wahrscheinlich.',
  'sub.custodian': 'Eine stillgelegte Custodian-Einheit. Die Augen sind dunkel. Der Staub auf ihren Schultern ist verwischt.',

  'board.title': 'DER MERIDIAN-JOB',
  'board.sub': 'Tiefenlager-Tresor · 90 m unter dem Meridian Tower',
  'board.locked': 'GESPERRT — erst Crew-Check',
  'board.soon': 'NÄCHSTER BUILD',
  'board.prep': 'VORBEREITUNG',
  'board.finale': 'FINALE',
  'board.reward': 'Schaltet frei',
  'm1.name': 'Der Architekt',
  'm1.desc': 'Brecht ins Büro des Planers ein und holt die Tresor-Baupläne.',
  'm1.reward': 'Baupläne',
  'm2.name': 'Totes Signal',
  'm2.desc': 'Rauf auf den Funkturm und den Sicherheits-Uplink kapern.',
  'm2.reward': 'Kamera-Spoofer',
  'm3.name': 'Kaltstart',
  'm3.desc': 'Holt den Fluchtwagen aus einem vollautomatischen Parkhaus.',
  'm3.reward': 'Fluchtfahrzeug',
  'm4.name': 'Scharfer Schuss',
  'm4.desc': 'Überfall auf das Testgelände eines Sicherheitsdienstes. Die Drohnen schießen zurück.',
  'm4.reward': 'EMP-Ausrüstung',
  'm5.name': 'Glashaus',
  'm5.desc': 'Durch ein Penthouse voller Laser schleichen und eine Keycard klonen.',
  'm5.reward': 'Zugangskarten',
  'm6.name': 'Unterstrom',
  'm6.desc': 'Das Stromnetz aus den Versorgungstunneln umleiten. Taschenlampe mitnehmen.',
  'm6.reward': 'Blackout-Ladung',
  'm7.name': 'Null Vault',
  'm7.desc': 'Der eigentliche Job. Fünf Phasen. Was auch immer in Tresor Ø liegt: Lasst es dort.',
  'm7.reward': 'Die Beute',

  'decoder.nopower': 'KEIN STROM',
  'decoder.title': 'DECODER',
  'legend.title': 'REIHENFOLGE',
  'vault.label': 'ÜBUNGSTRESOR',
  'closet.label': 'STROM',
  'c.red': 'ROT',
  'c.blue': 'BLAU',
  'c.green': 'GRÜN',
  'c.yellow': 'GELB',
};

const dicts: Record<Lang, Dict> = { en, de };

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = settings.get('lang');
  let s = dicts[lang][key] ?? en[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]));
  return s;
}

const langListeners = new Set<() => void>();
export function onLangChange(fn: () => void): () => void {
  langListeners.add(fn);
  return () => langListeners.delete(fn);
}
settings.onChange((_s, key) => {
  if (key === 'lang') {
    document.documentElement.lang = settings.get('lang');
    for (const l of langListeners) l();
  }
});
document.documentElement.lang = settings.get('lang');

/** Keys present in one language but not the other (used by the test suite). */
export function missingTranslations(): string[] {
  const out: string[] = [];
  for (const k in en) if (!(k in de)) out.push('de:' + k);
  for (const k in de) if (!(k in en)) out.push('en:' + k);
  return out;
}
