// Cursor state advances only after a successful owner-scoped page response.
export class PagedList {
  constructor(client, path) { this.client = client; this.path = path; this.items = []; this.cursor = null; this.version = 0; this.query = {}; }
  async load({ reset = false, query = this.query } = {}) {
    if (reset) { this.version++; this.query = query; }
    const version = this.version;
    const parameters = new URLSearchParams({ ...this.query, limit: '20', ...(!reset && this.cursor ? { cursor: this.cursor } : {}) });
    const page = await this.client.request(this.path + '?' + parameters);
    if (version !== this.version) return this;
    if (!Array.isArray(page.items) || !(page.next_cursor === null || typeof page.next_cursor === 'string')) throw new Error('列表响应无效，请刷新重试。');
    const rows = reset ? page.items : [...this.items, ...page.items];
    this.items = [...new Map(rows.map(row => [row.id, row])).values()];
    this.cursor = page.next_cursor;
    return this;
  }
}
