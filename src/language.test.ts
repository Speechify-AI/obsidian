import { describe, expect, it } from "vitest";
import { detectLanguage, languageToSend, normalizeTag, noteLanguage, withLanguages } from "./language.ts";
import { clipPassages, toPassages } from "./speakable.ts";

/** A paragraph or two in each language the detector tells apart. */
const SAMPLES: Record<string, string> = {
  en: "The plugin reads the note aloud and highlights the sentence that is being spoken. You can keep editing while it reads.",
  es: "El complemento lee la nota en voz alta y resalta la frase que se está leyendo. Puedes seguir editando mientras lee.",
  pt: "O plugin lê a nota em voz alta e destaca a frase que está sendo lida. Você pode continuar editando enquanto ele lê.",
  fr: "Le module lit la note à voix haute et surligne la phrase qui est en train d'être lue. Vous pouvez continuer à écrire pendant qu'il lit.",
  de: "Das Plugin liest die Notiz vor und hebt den Satz hervor, der gerade gesprochen wird. Du kannst weiter schreiben, während es liest.",
  it: "Il plugin legge la nota ad alta voce ed evidenzia la frase che viene letta. Puoi continuare a scrivere mentre legge.",
  nl: "De plugin leest de notitie voor en markeert de zin die op dat moment wordt uitgesproken. Je kunt blijven schrijven terwijl hij leest.",
  sv: "Tillägget läser anteckningen högt och markerar den mening som läses just nu. Du kan fortsätta skriva medan det läser.",
  da: "Udvidelsen læser noten højt og fremhæver den sætning, der bliver læst. Du kan fortsætte med at skrive, mens den læser, hvad du har skrevet.",
  no: "Utvidelsen leser notatet høyt og fremhever setningen som blir lest. Du kan fortsette å skrive mens den leser det du har skrevet.",
  fi: "Lisäosa lukee muistiinpanon ääneen ja korostaa lauseen, jota se parhaillaan lukee. Voit jatkaa kirjoittamista, kun se lukee.",
  hu: "A bővítmény felolvassa a jegyzetet, és kiemeli azt a mondatot, amelyet éppen olvas. Közben is lehet tovább írni.",
  pl: "Wtyczka czyta notatkę na głos i podświetla zdanie, które jest właśnie czytane. Możesz dalej pisać, gdy ona czyta.",
  cs: "Doplněk čte poznámku nahlas a zvýrazňuje větu, která je právě čtena. Můžete dál psát, zatímco čte.",
  sk: "Doplnok číta poznámku nahlas a zvýrazňuje vetu, ktorá sa práve číta. Môžete ďalej písať, kým číta.",
  sl: "Vtičnik bere zapisek na glas in označi stavek, ki ga ravno bere. Lahko še naprej pišete, medtem ko bere.",
  hr: "Dodatak čita bilješku naglas i označava rečenicu koja se upravo čita. Možete nastaviti pisati dok on čita.",
  ro: "Extensia citește notița cu voce tare și evidențiază propoziția care este citită. Poți continua să scrii în timp ce citește.",
  tr: "Eklenti notu sesli okur ve o anda okunan cümleyi vurgular. O okurken yazmaya devam edebilirsiniz.",
  id: "Plugin ini membaca catatan dengan suara keras dan menyorot kalimat yang sedang dibaca. Anda bisa terus menulis saat plugin membaca.",
  tl: "Binabasa ng plugin ang tala nang malakas at itinatampok ang pangungusap na binabasa. Maaari kang magpatuloy sa pagsusulat habang nagbabasa ito.",
  ca: "El complement llegeix la nota en veu alta i ressalta la frase que s'està llegint. Pots continuar escrivint mentre llegeix.",
  la: "Liber de natura rerum scriptus est, et in eo poeta de atomis et de vacuo disputat, quod multi non intellegunt.",
  vi: "Tiện ích đọc ghi chú thành tiếng và tô sáng câu đang được đọc. Bạn có thể tiếp tục viết trong khi nó đọc.",
  ru: "Плагин читает заметку вслух и выделяет предложение, которое произносится. Можно продолжать писать, пока он читает.",
  uk: "Плагін читає нотатку вголос і виділяє речення, яке зараз вимовляється. Можна продовжувати писати, поки він читає.",
  be: "Плагін чытае нататку ўголас і вылучае сказ, які зараз вымаўляецца. Можна працягваць пісаць, пакуль ён чытае.",
  kk: "Плагин жазбаны дауыстап оқиды және қазір айтылып жатқан сөйлемді белгілейді.",
  sr: "Додатак чита белешку наглас и означава реченицу која се управо чита. Можете наставити да пишете док он чита.",
  ar: "تقرأ الإضافة الملاحظة بصوت عالٍ وتُبرز الجملة التي تُقرأ الآن. يمكنك متابعة الكتابة أثناء القراءة.",
  fa: "افزونه یادداشت را با صدای بلند می‌خواند و جمله‌ای را که گفته می‌شود برجسته می‌کند. می‌توانید در حین خواندن به نوشتن ادامه دهید.",
  ur: "پلگ ان نوٹ کو بلند آواز میں پڑھتا ہے اور اس جملے کو نمایاں کرتا ہے جو پڑھا جا رہا ہے۔ آپ لکھتے رہ سکتے ہیں۔",
  he: "התוסף מקריא את הפתק בקול רם ומדגיש את המשפט שנאמר כרגע. אפשר להמשיך לכתוב בזמן שהוא קורא.",
  hi: "प्लगइन नोट को ज़ोर से पढ़ता है और उस वाक्य को हाइलाइट करता है जो बोला जा रहा है। आप पढ़ते समय लिखना जारी रख सकते हैं।",
  mr: "प्लगइन नोट मोठ्याने वाचते आणि जे वाक्य बोलले जात आहे ते ठळक करते. ते वाचत असताना तुम्ही लिहू शकता.",
  bn: "প্লাগইনটি নোটটি জোরে পড়ে এবং যে বাক্যটি বলা হচ্ছে তা হাইলাইট করে।",
  gu: "પ્લગઇન નોંધને મોટેથી વાંચે છે અને જે વાક્ય બોલાય છે તેને હાઇલાઇટ કરે છે.",
  ta: "செருகுநிரல் குறிப்பை சத்தமாக வாசித்து, பேசப்படும் வாக்கியத்தை தனிப்படுத்துகிறது.",
  te: "ప్లగిన్ నోట్‌ను గట్టిగా చదువుతుంది మరియు చెప్పబడుతున్న వాక్యాన్ని హైలైట్ చేస్తుంది.",
  th: "ปลั๊กอินอ่านโน้ตออกเสียงและเน้นประโยคที่กำลังพูดอยู่ คุณสามารถเขียนต่อได้ขณะที่มันอ่าน",
  ka: "დანამატი კითხულობს ჩანაწერს ხმამაღლა და გამოყოფს წინადადებას, რომელიც ამჟამად წარმოითქმის.",
  my: "ပလပ်အင်သည် မှတ်စုကို အသံထွက်ဖတ်ပြီး ပြောနေသော ဝါကျကို မီးမောင်းထိုးပြသည်။",
  el: "Το πρόσθετο διαβάζει τη σημείωση δυνατά και επισημαίνει την πρόταση που εκφωνείται.",
  ja: "プラグインはノートを読み上げ、話されている文をハイライトします。読んでいる間も書き続けることができます。",
  zh: "插件会朗读笔记，并高亮正在朗读的句子。朗读时你可以继续编辑。",
  ko: "플러그인은 노트를 소리 내어 읽고 현재 말하고 있는 문장을 강조 표시합니다.",
};

describe("detectLanguage", () => {
  for (const [language, sample] of Object.entries(SAMPLES)) {
    it(`reads ${language}`, () => {
      expect(detectLanguage(sample)).toBe(language);
    });
  }

  it("has no opinion on a heading or a name that says too little", () => {
    expect(detectLanguage("Introduction")).toBeNull();
    expect(detectLanguage("Casa de la Playa")).toBeNull();
    expect(detectLanguage("2026-10-29")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });

  it("takes two of one marker for no evidence at all", () => {
    // "J&J" is two bare j's, the elided French j'. On 2026-10-30 that carried
    // a whole English list, and the heading over it, into French.
    expect(detectLanguage("J&J")).toBeNull();
    expect(detectLanguage("Cadre: voice receptionist POC (J&J Insurance evaluation)")).toBeNull();
    expect(detectLanguage("J. R. R. Tolkien wrote it")).toBeNull();
    expect(detectLanguage("S&P 500 closed higher")).toBeNull();
  });

  it("goes by the script that most of the text is in", () => {
    expect(detectLanguage("The word for cat in Japanese is 猫, and it is read as the English around it.")).toBe("en");
    expect(detectLanguage("漢字だけでなく、かなも使う。")).toBe("ja");
  });

  it("scores letters the way they are typed, composed or not", () => {
    expect(detectLanguage(SAMPLES.vi!.normalize("NFD"))).toBe("vi");
  });
});

describe("noteLanguage", () => {
  it("reads a lang or language property from closed frontmatter", () => {
    expect(noteLanguage("---\ntitle: x\nlang: fr\n---\nBonjour")).toBe("fr");
    expect(noteLanguage('---\nlanguage: "pt-br"\n---\nOlá')).toBe("pt-BR");
    expect(noteLanguage("---\nlang: de\n")).toBeNull();
    expect(noteLanguage("lang: de\n\nText")).toBeNull();
    expect(noteLanguage("---\nlang: French\n---\n")).toBeNull();
  });

  it("normalizes a tag and refuses what is not one", () => {
    expect(normalizeTag("ZH-hans")).toBe("zh-hans");
    expect(normalizeTag("EN-gb")).toBe("en-GB");
    expect(normalizeTag("english")).toBeNull();
  });
});

describe("withLanguages", () => {
  it("gives a short block the note's language and a foreign block its own", () => {
    const source = `${SAMPLES.en}\n\n## Résumé\n\n${SAMPLES.fr}\n\n- Done`;
    const spoken = withLanguages(toPassages(source), source, true);
    expect(spoken.map((p) => p.language)).toEqual(["en", "fr", "fr", "fr"]);
  });

  it("gives a block that says too little the nearest decided one, the one after it first", () => {
    const source = `# Résumé\n\n${SAMPLES.fr}\n\n## Notes\n\n${SAMPLES.en}\n\n- Done`;
    const spoken = withLanguages(toPassages(source), source, true);
    expect(spoken.map((p) => p.language)).toEqual(["fr", "fr", "en", "en", "en"]);
  });

  it("lets the lang property stand for the note, and the blocks still speak for themselves", () => {
    const source = `---\nlang: de\n---\n# Notizen\n\n${SAMPLES.en}`;
    const spoken = withLanguages(toPassages(source), source, true);
    expect(spoken.map((p) => p.language)).toEqual(["en", "en"]);
    const alone = "---\nlang: de\n---\n# Notizen";
    expect(withLanguages(toPassages(alone), alone, true).map((p) => p.language)).toEqual(["de"]);
  });

  it("sends the property where it is a finer answer than the detector's", () => {
    const malay = "Kami boleh menulis nota ini dan membaca dengan kuat kerana plugin ini akan membaca untuk anda dan tidak ada masalah.";
    const source = `---\nlang: ms\n---\n${malay}\n\n${SAMPLES.en}`;
    expect(withLanguages(toPassages(source), source, true).map((p) => p.language)).toEqual(["ms", "en"]);
    const brazil = `---\nlang: pt-BR\n---\n${SAMPLES.pt}`;
    expect(withLanguages(toPassages(brazil), brazil, true).map((p) => p.language)).toEqual(["pt-BR"]);
  });

  it("keeps an English list English when one line carries a pair of initials", () => {
    const source = [
      "## Customers",
      "",
      "- AssemblyAI: accent stability demo",
      "- Cadre: voice receptionist POC (J&J Insurance evaluation)",
      "- Noa: article-to-MP3 API demo",
      "",
      `${SAMPLES.en}`,
    ].join("\n");
    const spoken = withLanguages(toPassages(source), source, true);
    expect(spoken.map((p) => p.language)).toEqual(spoken.map(() => "en"));
  });

  it("keeps its answer when a selection is clipped out", () => {
    const source = `${SAMPLES.en}\n\n## Summary\n\n${SAMPLES.fr}`;
    const spoken = withLanguages(toPassages(source), source, true);
    const heading = source.indexOf("Summary");
    const clipped = clipPassages(spoken, heading, heading + 7);
    expect(clipped.map((p) => [p.text, p.language])).toEqual([["Summary", "fr"]]);
  });

  it("with detection off, only the property counts", () => {
    const en = withLanguages(toPassages(SAMPLES.fr!), SAMPLES.fr!, false);
    expect(en.map((p) => p.language)).toEqual([null]);
    const source = `---\nlang: fr\n---\n${SAMPLES.en}`;
    expect(withLanguages(toPassages(source), source, false).map((p) => p.language)).toEqual(["fr"]);
  });
});

describe("languageToSend", () => {
  it("names the language only when it is not the voice's own", () => {
    expect(languageToSend("fr", "en-US")).toBe("fr");
    expect(languageToSend("en", "en-US")).toBeUndefined();
    expect(languageToSend("en-GB", "en-US")).toBeUndefined();
    expect(languageToSend("pt-BR", "pt-PT")).toBeUndefined();
    expect(languageToSend(null, "en-US")).toBeUndefined();
    expect(languageToSend("en", "")).toBe("en");
  });
});
