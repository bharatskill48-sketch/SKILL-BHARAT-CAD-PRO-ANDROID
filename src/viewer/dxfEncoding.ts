const CODE_PAGES: Readonly<Record<string, string>> = {
  ANSI_874: "windows-874",
  ANSI_932: "shift_jis",
  ANSI_936: "gbk",
  ANSI_949: "euc-kr",
  ANSI_950: "big5",
  ANSI_1250: "windows-1250",
  ANSI_1251: "windows-1251",
  ANSI_1252: "windows-1252",
  ANSI_1253: "windows-1253",
  ANSI_1254: "windows-1254",
  ANSI_1255: "windows-1255",
  ANSI_1256: "windows-1256",
  ANSI_1257: "windows-1257",
  ANSI_1258: "windows-1258",
  DOS437: "ibm437",
  DOS850: "ibm850",
  DOS852: "ibm852",
  DOS855: "ibm855",
  DOS857: "ibm857",
  DOS860: "ibm860",
  DOS861: "ibm861",
  DOS863: "ibm863",
  DOS864: "ibm864",
  DOS865: "ibm865",
  DOS866: "ibm866",
};

/** Inspect only the ASCII header; the complete drawing is decoded in its worker. */
export function detectDxfEncoding(prefix: Uint8Array): string {
  if (prefix[0] === 0xff && prefix[1] === 0xfe) {
    return "utf-16le";
  }
  if (prefix[0] === 0xfe && prefix[1] === 0xff) {
    return "utf-16be";
  }
  if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) {
    return "utf-8";
  }

  const header = new TextDecoder().decode(prefix).split(/\r\n|\n|\r/);
  let version: number | undefined;
  let codePage: string | undefined;
  for (let index = 0; index + 3 < header.length; index += 2) {
    if (header[index].trim() !== "9") {
      continue;
    }
    const variable = header[index + 1].trim();
    const value = header[index + 3].trim();
    if (variable === "$ACADVER" && /^AC\d{4}$/.test(value)) {
      version = Number(value.slice(2));
    } else if (variable === "$DWGCODEPAGE") {
      codePage = value.toUpperCase();
    }
  }

  // AutoCAD 2007+ text is UTF-8 even when DWGCODEPAGE retains an older label.
  if (version !== undefined && version >= 1021) {
    return "utf-8";
  }
  const encoding = codePage ? CODE_PAGES[codePage] : undefined;
  if (encoding) {
    try {
      // Android WebView implements the WHATWG encoding set. Some historical
      // DOS code pages are unavailable there; keep the safe default in that case.
      return new TextDecoder(encoding).encoding;
    } catch {
      return "utf-8";
    }
  }
  return "utf-8";
}
