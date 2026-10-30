/**
 * Which language a piece of a note is written in, so it can be sent as the
 * request's `language` and read as that language in the chosen voice.
 *
 * On simba-3.5 every voice speaks all 48 languages, but when `language` is
 * omitted the voice's own locale decides, so an English voice reads a French
 * paragraph as if it were English. Detection is done here, on the device,
 * because the API does not guess and a detector that phoned home would send
 * the note somewhere other than Speechify.
 *
 * The detector is small by design. The script settles most languages on its
 * own (Thai is Thai). Latin, Cyrillic, Arabic and Devanagari text is scored
 * on function words and marker letters, each weighted by how many languages
 * share it: "the" is one point for English, "de" a fraction for each of the
 * languages it belongs to. A winner needs a lead, so a short heading comes
 * back as nothing and takes the language of the note around it.
 *
 * Not told apart: Bosnian and Serbian in Latin script from Croatian, and
 * Malay from Indonesian, whose function words are the same; those notes can
 * say so in a `lang` property, which wins over the answer it is a finer
 * version of.
 */
import type { Passage } from "./speakable.ts";

/** A language tag the API accepts: "fr", or "pt-BR". */
const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** A `lang` (or `language`) property in the note's frontmatter, or null. */
export function noteLanguage(source: string): string | null {
  const lines = source.split("\n");
  if (lines[0]?.trimEnd() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
  if (end === -1) return null;
  for (const line of lines.slice(1, end)) {
    const match = /^(?:lang|language):[ \t]*["']?([^"'\s]+)["']?[ \t]*$/.exec(line);
    if (match) return normalizeTag(match[1] ?? "");
  }
  return null;
}

/** "PT-br" as "pt-BR"; null for anything that is not a tag. */
export function normalizeTag(tag: string): string | null {
  if (!TAG.test(tag)) return null;
  const [primary = "", ...rest] = tag.split("-");
  return [primary.toLowerCase(), ...rest.map((part) => (part.length === 2 ? part.toUpperCase() : part))].join("-");
}

/**
 * What to send as `language`: nothing when the text is in the voice's own
 * language, since that is what the API assumes, and sending it would only
 * move every existing render to a new cache key.
 */
export function languageToSend(language: string | null, voiceLocale: string): string | undefined {
  if (language === null) return undefined;
  const primary = (tag: string): string => tag.split("-")[0]?.toLowerCase() ?? "";
  return primary(language) === primary(voiceLocale) ? undefined : language;
}

/** What the detector answers for a language it cannot tell from a neighbour. */
const FOLDED_INTO: Record<string, string> = { ms: "id", bs: "hr", sr: "hr" };

/** Is `property` a finer answer than `detected`: a region of it, or a language folded into it? */
function refines(property: string, detected: string): boolean {
  const primary = property.split("-")[0]?.toLowerCase() ?? "";
  return primary === detected || FOLDED_INTO[primary] === detected;
}

export type Spoken = Passage & {
  /** The language the passage is read in, or null for the voice's own. */
  language: string | null;
};

/**
 * Each passage's language: its block's when the block says enough. A block
 * that says too little (a heading, a one-word list item) takes the language
 * of the nearest block that does, the one after it first since a heading
 * introduces what follows, and failing that the note's: the `lang`
 * property, or what the whole note reads as.
 * The property also stands in for any block it is a finer answer to, so
 * `lang: pt-BR` is sent for Portuguese blocks and `lang: ms` for Malay ones
 * the detector can only call Indonesian. With `detect` off only the
 * property counts.
 */
export function withLanguages(passages: readonly Passage[], source: string, detect: boolean): Spoken[] {
  const property = noteLanguage(source);
  if (!detect) return passages.map((passage) => ({ ...passage, language: property }));

  const blocks = new Map<number, string>();
  for (const passage of passages) blocks.set(passage.block, `${blocks.get(passage.block) ?? ""}\n${passage.text}`);
  const decided = new Map<number, string | null>();
  for (const [block, text] of blocks) {
    const detected = detectLanguage(text);
    decided.set(block, property !== null && detected !== null && refines(property, detected) ? property : detected);
  }
  const note = property ?? detectLanguage(passages.map((p) => p.text).join("\n"));

  const order = [...blocks.keys()];
  const languages = new Map<number, string | null>();
  let previous: string | null = null;
  order.forEach((block, i) => {
    const own = decided.get(block) ?? null;
    const next = order.slice(i + 1).map((later) => decided.get(later) ?? null).find((language) => language !== null) ?? null;
    languages.set(block, own ?? next ?? previous ?? note);
    if (own !== null) previous = own;
  });
  return passages.map((passage) => ({ ...passage, language: languages.get(passage.block) ?? note }));
}

// ---- the detector ------------------------------------------------------------

/** Letters of each script. The one with the most letters decides how the text is read. */
const SCRIPTS: { letters: RegExp; resolve: (text: string) => string | null }[] = [
  { letters: /\p{Script=Latin}/gu, resolve: (text) => scored(text, LATIN) },
  { letters: /\p{Script=Cyrillic}/gu, resolve: cyrillic },
  { letters: /\p{Script=Arabic}/gu, resolve: arabic },
  { letters: /\p{Script=Devanagari}/gu, resolve: (text) => scored(text, DEVANAGARI) ?? "hi" },
  { letters: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, resolve: (text) => (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? "ja" : "zh") },
  { letters: /\p{Script=Hangul}/gu, resolve: () => "ko" },
  { letters: /\p{Script=Greek}/gu, resolve: () => "el" },
  { letters: /\p{Script=Hebrew}/gu, resolve: () => "he" },
  { letters: /\p{Script=Bengali}/gu, resolve: () => "bn" },
  { letters: /\p{Script=Gujarati}/gu, resolve: () => "gu" },
  { letters: /\p{Script=Tamil}/gu, resolve: () => "ta" },
  { letters: /\p{Script=Telugu}/gu, resolve: () => "te" },
  { letters: /\p{Script=Thai}/gu, resolve: () => "th" },
  { letters: /\p{Script=Georgian}/gu, resolve: () => "ka" },
  { letters: /\p{Script=Myanmar}/gu, resolve: () => "my" },
];

/** The language `text` is written in, as one of Speechify's codes, or null when it cannot be told. */
export function detectLanguage(text: string): string | null {
  let best: { count: number; resolve: (text: string) => string | null } | null = null;
  for (const script of SCRIPTS) {
    const count = text.match(script.letters)?.length ?? 0;
    if (count > (best?.count ?? 0)) best = { count, resolve: script.resolve };
  }
  return best ? best.resolve(text) : null;
}

function cyrillic(text: string): string {
  if (/[әғқңөұүһ]/i.test(text)) return "kk";
  if (/[јљњђћџ]/i.test(text)) return "sr";
  if (/ў/i.test(text)) return "be";
  if (/[їєґ]/i.test(text)) return "uk";
  // Both write і; only Belarusian has done away with и.
  if (/і/i.test(text)) return /и/i.test(text) ? "uk" : "be";
  return "ru";
}

function arabic(text: string): string {
  if (/[ٹڈڑںے]/.test(text)) return "ur";
  if (/[پچژگ]/.test(text)) return "fa";
  return "ar";
}

interface Markers {
  /** Function words, by language. */
  words: Record<string, string>;
  /** Letters (or marks), each with the languages that write them. */
  letters: [letters: string, languages: string][];
}

/** Pairs whose function words are nearly the same: the leader is judged against the next language instead. */
const SIBLINGS = [["da", "no"]];

/**
 * Score every language a marker belongs to, 1/n per occurrence, and take
 * the leader if it leads clearly: at least two points, two markers that are
 * not the same one twice, a point ahead, and a fifth more than the runner-up.
 *
 * Two of one marker is not evidence. "J&J" in an English line is two bare
 * `j`s, the elided French `j'`, and used to carry the line, the heading over
 * it and every undecided block after it into French (measured 2026-10-30).
 */
function scored(text: string, markers: Markers): string | null {
  const index = markerIndex(markers);
  const score = new Map<string, number>();
  const distinct = new Map<string, Set<string>>();
  const add = (languages: readonly string[] | undefined, marker: string): void => {
    if (!languages) return;
    for (const language of languages) {
      score.set(language, (score.get(language) ?? 0) + 1 / languages.length);
      const seen = distinct.get(language) ?? new Set<string>();
      seen.add(marker);
      distinct.set(language, seen);
    }
  };
  const lower = text.normalize("NFC").toLowerCase();
  for (const word of lower.match(/[\p{L}\p{M}]+/gu) ?? []) add(index.words.get(word), word);
  for (const ch of lower) add(index.letters.get(ch), ch);

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second, third] = ranked;
  if (!first || first[1] < 2 || (distinct.get(first[0])?.size ?? 0) < 2) return null;
  const siblings = second !== undefined && SIBLINGS.some((pair) => pair.includes(first[0]) && pair.includes(second[0]));
  const runnerUp = (siblings ? third : second)?.[1] ?? 0;
  return first[1] - runnerUp >= 1 && first[1] >= 1.2 * runnerUp ? first[0] : null;
}

const indexes = new WeakMap<Markers, { words: Map<string, string[]>; letters: Map<string, string[]> }>();

function markerIndex(markers: Markers): { words: Map<string, string[]>; letters: Map<string, string[]> } {
  let index = indexes.get(markers);
  if (index) return index;
  const words = new Map<string, string[]>();
  for (const [language, list] of Object.entries(markers.words)) {
    for (const word of list.split(/\s+/)) {
      if (word !== "") words.set(word, [...(words.get(word) ?? []), language]);
    }
  }
  const letters = new Map<string, string[]>();
  for (const [list, languages] of markers.letters) {
    for (const ch of list) letters.set(ch, [...(letters.get(ch) ?? []), ...languages.split(" ")]);
  }
  index = { words, letters };
  indexes.set(markers, index);
  return index;
}

const LATIN: Markers = {
  words: {
    en: "the of and to in is that it for was on are as with be at this from or had by not but what all were we when your can there an which do how their if will up other about out many then them these so some would make like him into time has more see no way could people my than first been who its now find long day did get come may part you he she they have",
    es: "el la los las de que y en un una es por con para no se su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde desde todo nos durante todos uno les ni contra otros ese eso ante ellos esto antes algunos qué unos yo otro otras otra él tanto esa estos mucho nada muchos cual poco ella estar estas algo nosotros está están mientras aunque aquí allí cada siempre nunca aún según hacia usted ustedes puede pueden puedes era eran fue fueron son sería había han ha he hemos",
    pt: "o a os as de que e do da em um para é com não uma no se na por mais dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas seja qual será nós tenho lhe deles essas esses pelas este dele",
    fr: "le la les de des du que qui et à en un une est pour dans ce cette il elle ils elles ne pas sur avec au aux son sa ses leur mais ou où par plus je tu nous vous se sont été être avoir fait l d qu j c n s cela ces votre notre comme tout tous très aussi bien même encore sans sous après avant entre chez pendant peut peuvent",
    de: "der die das und ist nicht ein eine zu ich sich mit auf für von den dem des im in auch es an als wie aber nur noch oder wenn kann wir sie er bei nach aus durch man hat wird sind werden über einen einem einer dieser diese dieses was so schon dann wurde zum zur vom beim ihr ihre ihrem seine seiner mich dich uns euch während kannst können",
    it: "il la lo gli le di che e a in un una per con non è sono si da come ma più al del della dei delle nel nella anche questo questa ci se ha hanno era essere stato alla allo agli dal dalla sul sulla col coi però quindi perché molto tutto tutti ogni cui loro noi voi io lui lei suo sua ed ad puoi può mentre viene così dove sempre ancora già poi senza tra fra nei negli nelle degli dello mi ti ne",
    nl: "de het een en van ik je niet dat die is in op te zijn met voor er maar om aan ook als dan nog wel naar bij uit over zo hij ze wat hebben worden kan al ja deze dit geen veel moet door tegen jullie u mijn jouw haar hun ons onze wij we heeft werd wordt",
    sv: "och att det är en ett jag som inte på för med av till han hon den de har var om kan ska vi här sig vad man du mig dig sin sitt sina mycket där när eller men från också bara nu detta dessa denna hade blev vara varit vilket",
    da: "og at det er en et jeg som ikke på for med af til han hun den de har var om kan skal vi her sig hvad man du mig dig sin sit sine meget der når eller men fra også bare nu dette denne disse havde blev bliver være været hvilket efter noget nogle nogen kun mellem uden hvordan hvorfor hvor end mens",
    no: "og at det er en et jeg som ikke på for med av til han hun den de har var om kan skal vi her seg hva man du meg deg sin sitt sine mye der når eller men fra også bare nå dette denne disse hadde ble blir være vært hvilket etter noe noen mellom uten hvordan hvorfor hvor enn mens",
    fi: "ja on ei että se oli hän mutta kun ovat myös niin tai ole vain sen kuin hänen joka olla mitä tämä nyt sitä jos kaikki minä sinä me te he olen olet olemme ollut jo vielä sitten tässä siinä kanssa ilman jotta koska vaikka kuten sekä eli jota jossa jonka jolla jotka mikä miten missä voi voit voidaan pitää tulee tämän näin siis aina usein paljon hyvin parhaillaan",
    hu: "a az és hogy nem is egy meg van de csak ha már el mint volt ki vagy még azt ezt ez mi itt mert így lehet ők én te ti aki ami amely ahol amikor mindig minden nagyon",
    pl: "i w z na się nie że do jest to jak o co a po tak od ale przez przy dla jego jej tym czy już tylko są był była być może bardzo który która które ich nas was oraz lub gdy też także",
    cs: "a v se na je že to z s do jak ale za od po pro jsou byl byla bylo být jsem jsi jsme tak jako když už také nebo který která které jeho její jejich nás vás velmi ještě jen",
    sk: "a v sa na je že to z s do ako ale za od po pre sú bol bola bolo byť som si sme tak keď už tiež alebo ktorý ktorá ktoré jeho jej ich nás vás veľmi ešte len",
    sl: "in je v se na da so za ne z s ki pa tudi bi kot ali po do kar bo še od ker lahko ima biti sem si smo ste jih njih zelo",
    hr: "i je u se na da su za ne s od do kao ali koji koja koje ili bio bila biti sam si smo sa što šta tko ko ovo ovaj ova ovu samo vrlo još kako gdje kada",
    ro: "și în de la cu pe este sunt pentru nu se ce care un o mai din sau dar că au fost fi fiind acest această aceasta acesta eu tu el ea noi voi ei ele foarte după până între prin",
    tr: "ve bir bu da de için ile çok daha olarak var ne gibi ben sen o biz siz onlar ama değil mi en kadar sonra her şey hiç bütün ancak veya ya yok oldu olan şu fakat çünkü yani eğer ise ki mı mu mü nasıl neden nerede hangi az pek tüm bazı kendi bana sana ona bize size beni seni onu bizi sizi benim senin onun bizim sizin evet hayır şimdi burada orada artık hep yine zaten belki olur anda",
    id: "dan yang di untuk dengan ini itu dari tidak adalah pada akan ke juga ada saya kami mereka bisa karena kita anda dia sudah telah belum bahwa oleh sebagai sangat lebih harus dapat",
    tl: "ang ng sa na at ay mga ko mo siya ako ikaw kami kayo sila ito iyon hindi din rin kung para may lang naman po ba daw ngayon dahil pero kasi",
    ca: "el la els les de que i en un una és per amb no es del al com més però seu seva seus seves aquest aquesta això ja hi ho també són va ser està l d qu mentre pots pot poden dels als pel pels fins sense sobre entre quan on què qui quin quina tot tots tota totes cap cada molt menys només encara sempre mai ara aquí allà així doncs perquè si sinó jo ell ella nosaltres vosaltres ells elles em et ens us li era eren estan ha han he hem heu",
    la: "et in est non ad cum sed ut quod qui quae quam de ex atque enim esse sunt erat autem nec per hoc haec id ab pro sine inter omnia omnes",
    vi: "và của là có không được trong một những cho người này đã với các để tôi bạn anh chị như khi thì mà đó về từ ra nhưng còn nếu",
  },
  letters: [
    ["ñ¿¡", "es"],
    ["ãõ", "pt"],
    ["œ", "fr"],
    ["ß", "de"],
    ["å", "sv da no"],
    ["øæ", "da no"],
    ["őű", "hu"],
    ["łąęśźżń", "pl"],
    ["řěů", "cs"],
    ["ľĺŕ", "sk"],
    ["ğı", "tr"],
    ["șțţ", "ro"],
    ["ş", "tr ro"],
    ["ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ", "vi"],
    ["·", "ca"],
    ["ä", "de fi sv sk"],
    ["ö", "de fi sv hu tr"],
    ["ü", "de hu tr"],
    ["ç", "fr pt ca tr"],
    ["ć", "pl hr"],
    ["žšč", "cs sk sl hr"],
    ["ă", "ro vi"],
    ["âê", "fr pt vi"],
    ["î", "fr ro"],
    ["ô", "fr pt sk vi"],
    ["è", "fr it ca"],
    ["ìò", "it ca"],
    ["à", "fr it ca pt"],
    ["é", "fr es pt ca it hu"],
    ["íóúá", "es pt ca hu cs sk"],
    ["ý", "cs sk vi"],
    ["đ", "vi hr"],
  ],
};

const DEVANAGARI: Markers = {
  words: {
    hi: "है हैं का की के में और को यह था थे थी नहीं से पर भी ने हो कर हम वह इस उस तो जो एक लिए गया किया कहा कुछ अपने",
    mr: "आहे आहेत आणि नाही मध्ये ची चा चे होते होता करून म्हणून असे या त्या तो ती ते मी आम्ही तुम्ही केले केली झाले झाली किंवा पण",
  },
  letters: [["ळ", "mr"]],
};
