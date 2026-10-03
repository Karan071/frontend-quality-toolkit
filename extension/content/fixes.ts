const STYLE_ID = '__ftk-fixes';

interface Fix {
  id: string;
  label?: string;
  css: string;
}

/**
 * Temporary CSS fixes live in a single <style> element so they can be applied,
 * reverted individually, or cleared in one step. Nothing touches the page's
 * own stylesheets or the server.
 */
export class FixStore {
  private fixes = new Map<string, Fix>();
  private el: HTMLStyleElement | null = null;

  apply(id: string, css: string, label?: string) {
    this.fixes.set(id, { id, css, label });
    this.flush();
    return this.fixes.size;
  }

  remove(id: string) {
    this.fixes.delete(id);
    this.flush();
    return this.fixes.size;
  }

  clear() {
    this.fixes.clear();
    this.flush();
    return 0;
  }

  list() {
    return [...this.fixes.values()];
  }

  private flush() {
    if (this.fixes.size === 0) {
      this.el?.remove();
      this.el = null;
      return;
    }
    if (!this.el || !this.el.isConnected) {
      this.el = document.createElement('style');
      this.el.id = STYLE_ID;
      document.documentElement.appendChild(this.el);
    }
    this.el.textContent = [...this.fixes.values()].map((f) => `/* ${f.id} */\n${f.css}`).join('\n\n');
  }
}
