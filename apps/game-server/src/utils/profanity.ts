// Common substitutions (leet-speak normalization before checking)
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
}

// Substrings blocked in usernames (display names are not checked — hosts moderate chat)
const BLOCKED: string[] = [
  'fuck', 'fuk', 'fck',
  'shit', 'sht',
  'cunt',
  'cock',
  'pussy',
  'nigger', 'nigga',
  'faggot', 'fagot',
  'bitch',
  'whore',
  'slut',
  'asshole',
  'dickhead',
  'retard',
  'kike',
  'spic',
  'chink',
  'twat',
  'wanker',
  'rape',
  'pedo',
];

export function containsProfanity(username: string): boolean {
  const n = normalize(username);
  return BLOCKED.some((w) => n.includes(w));
}
