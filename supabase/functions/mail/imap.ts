// Minimaler IMAP-Client über Deno.connectTls (nur das, was die App braucht).
const enc = new TextEncoder();
const dec = new TextDecoder('latin1'); // Bytes 1:1 erhalten

export type Item = { line: string; lits: Uint8Array[] };

export class Imap {
  conn!: Deno.TlsConn;
  buf = new Uint8Array(0);
  n = 0;

  static async open(host: string, port: number, user: string, pass: string) {
    const c = new Imap();
    c.conn = await Deno.connectTls({ hostname: host, port });
    await c.readLine(); // Begrüßung
    const r = await c.cmd(`LOGIN ${q(user)} ${q(pass)}`);
    if (!r.ok) throw new Error('IMAP-Login fehlgeschlagen: ' + r.status);
    return c;
  }

  private async fill() {
    const chunk = new Uint8Array(65536);
    const k = await this.conn.read(chunk);
    if (k === null) throw new Error('IMAP-Verbindung beendet');
    const nb = new Uint8Array(this.buf.length + k);
    nb.set(this.buf); nb.set(chunk.subarray(0, k), this.buf.length);
    this.buf = nb;
  }
  private async readLine(): Promise<string> {
    for (;;) {
      for (let i = 0; i < this.buf.length - 1; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const s = dec.decode(this.buf.subarray(0, i));
          this.buf = this.buf.subarray(i + 2);
          return s;
        }
      }
      await this.fill();
    }
  }
  private async readBytes(len: number): Promise<Uint8Array> {
    while (this.buf.length < len) await this.fill();
    const out = this.buf.slice(0, len);
    this.buf = this.buf.subarray(len);
    return out;
  }

  /** Befehl senden, alle Antworten bis zur getaggten Zeile einsammeln. */
  async cmd(line: string, literal?: Uint8Array): Promise<{ ok: boolean; status: string; items: Item[] }> {
    const tag = 'A' + ++this.n;
    if (literal) {
      await this.write(enc.encode(`${tag} ${line} {${literal.length}}\r\n`));
      const cont = await this.readLine(); // "+ ..."
      if (!cont.startsWith('+')) return { ok: false, status: cont, items: [] };
      await this.write(literal); await this.write(enc.encode('\r\n'));
    } else {
      await this.write(enc.encode(`${tag} ${line}\r\n`));
    }
    const items: Item[] = [];
    for (;;) {
      let text = await this.readLine();
      if (text.startsWith(tag + ' ')) {
        const status = text.slice(tag.length + 1);
        return { ok: /^OK/i.test(status), status, items };
      }
      const lits: Uint8Array[] = [];
      let m;
      while ((m = text.match(/\{(\d+)\}$/))) {
        lits.push(await this.readBytes(+m[1]));
        text = text.slice(0, text.length - m[0].length) + `\u0000L${lits.length - 1}\u0000` + (await this.readLine());
      }
      items.push({ line: text, lits });
    }
  }
  private async write(b: Uint8Array) {
    let o = 0;
    while (o < b.length) o += await this.conn.write(b.subarray(o));
  }
  async logout() { try { await this.cmd('LOGOUT'); } catch (_) { /* egal */ } try { this.conn.close(); } catch (_) { /* egal */ } }
}

export const q = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Modified-UTF-7 für Ordnernamen (RFC 3501)
export function decodeMailbox(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, p) => {
    if (p === '') return '&';
    const b64 = p.replace(/,/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    let out = '';
    for (let i = 0; i < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return out;
  });
}
export function encodeMailbox(s: string): string {
  return s.replace(/[^\x20-\x7e]+|&/g, (m) => {
    if (m === '&') return '&-';
    let bin = '';
    for (const ch of m) bin += String.fromCharCode(ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 255);
    return '&' + btoa(bin).replace(/=+$/, '').replace(/\//g, ',') + '-';
  });
}

/** LIST-Antworten → {name (roh), attrs, display} */
export function parseList(items: Item[]) {
  const out: { name: string; attrs: string[]; display: string }[] = [];
  for (const it of items) {
    const m = it.line.match(/^\* LIST \(([^)]*)\) (?:"(.)"|NIL) (.+)$/);
    if (!m) continue;
    let name = m[3].trim();
    if (name.startsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
    out.push({ name, attrs: m[1].split(' ').filter(Boolean).map((x) => x.toLowerCase()), display: decodeMailbox(name) });
  }
  return out;
}
