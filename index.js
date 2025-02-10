import puppeteer from 'puppeteer';
import fs from 'fs';

// Configuración general
const config = {
  outputFile: 'PRODUCTOS_TOP.md',
  maxPages: 3,
  retries: 3,
  headless: true,
  userDataDir: './user_data',
  scrollDelay: 2000,
  requestDelay: { min: 2000, max: 5000 },
};

// Utilidades
const utils = {
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  randomDelay: () =>
    utils.delay(Math.random() * (config.requestDelay.max - config.requestDelay.min) + config.requestDelay.min),
  sanitizeText: (text) => text.replace(/[\n\r]+|[\s]{2,}/g, ' ').trim(),
  formatPrice: (price) => price.replace(/[^\d.,]/g, '').trim(),
  log: (message, type = 'info') => console.log(`[${type.toUpperCase()}] ${new Date().toISOString()} - ${message}`),
};

// Configuración de sitios
const sites = {
  amazon: {
    name: '🛍️ Amazon',
    url: 'https://www.amazon.com/s?rh=n%3A16225007011&fs=true',
    pagination: '&page=',
    selectors: {
      container: 'div.s-result-item',
      title: ['h2 a.a-text-normal'],
      price: 'span.a-price > span.a-offscreen',
      image: 'img.s-image',
      link: 'h2 a.a-link-normal',
      rating: 'i.a-icon-star-small span.a-icon-alt',
      reviews: 'span.a-size-base.s-underline-text',
    },
    paginationType: 'selector',
    nextPage: 'a.s-pagination-next',
  },
  temu: {
    name: '🎯 Temu',
    url: 'https://www.temu.com/es/channel/best-sellers.html',
    selectors: {
      container: 'div.product-item',
      title: 'div.product-title',
      price: 'div.price-now',
      image: 'img.product-img',
      link: 'a.product-link',
      rating: 'div.rating-value',
      reviews: 'span.review-count',
    },
    paginationType: 'infinite-scroll',
  },
  alibaba: {
    name: '🌐 Alibaba',
    url: 'https://es.aliexpress.com/w/wholesale-productos-mas-vendidos.html',
    pagination: '?page=',
    selectors: {
      container: '.manhattan--container--dDQKmJF',
      title: '.manhattan--titleText--WwAKrJ1',
      price: '.manhattan--price-sale--dDQKmJF',
      image: '.manhattan--image--dDQKmJF img',
      link: '.manhattan--container--dDQKmJF a',
      rating: '.manhattan--rating--dDQKmJF',
      reviews: '.manhattan--reviews--dDQKmJF',
    },
    paginationType: 'selector',
    nextPage: '.lucide.lucide-chevron-right.il-h-4.il-w-4',
  },
  corteingles: {
    name: '🏪 El Corte Inglés',
    url: 'https://www.elcorteingles.es/parafarmacia/cuidados-rostro/?sorting=bestSellerQtyDesc',
    selectors: {
      container: '.product-item',
      title: 'a.product_preview-title',
      price: 'section.price .price-sale',
      image: 'img.lazyload',
      link: 'a.product_preview-title',
      rating: '.product-rating',
      reviews: '.product-reviews',
    },
    paginationType: 'infinite-scroll',
  },
};

class Scraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.products = [];
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: config.headless,
      defaultViewport: null,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      userDataDir: config.userDataDir,
    });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );
  }

  async scrapeSite(siteConfig) {
    utils.log(`Iniciando scraping en: ${siteConfig.name}`);
    let currentPage = 1;

    while (currentPage <= config.maxPages) {
      try {
        const url = siteConfig.pagination
          ? `${siteConfig.url}${siteConfig.pagination}${currentPage}`
          : siteConfig.url;

        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        if (siteConfig.paginationType === 'infinite-scroll') {
          await this.handleInfiniteScroll();
        }

        const products = await this.extractProducts(siteConfig);
        this.products.push(...products);

        if (!await this.goToNextPage(siteConfig)) break;

        currentPage++;
        await utils.randomDelay();
      } catch (error) {
        utils.log(`Error en página ${currentPage}: ${error.message}`, 'error');
        break;
      }
    }
  }

  async handleInfiniteScroll() {
    let previousHeight = 0;
    let sameHeightCount = 0;

    while (sameHeightCount < 3) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await utils.delay(config.scrollDelay);

      const newHeight = await this.page.evaluate('document.body.scrollHeight');
      if (newHeight === previousHeight) sameHeightCount++;
      else sameHeightCount = 0;

      previousHeight = newHeight;
    }
  }

  async extractProducts(siteConfig) {
    const productHandles = await this.page.$$(siteConfig.selectors.container);
    return Promise.all(
      productHandles.map(async (handle) => {
        try {
          return {
            title: await this.extractText(handle, siteConfig.selectors.title),
            price: utils.formatPrice(await this.extractText(handle, siteConfig.selectors.price)),
            image: await this.extractAttribute(handle, siteConfig.selectors.image, 'src'),
            link: await this.extractAttribute(handle, siteConfig.selectors.link, 'href'),
            rating: await this.extractText(handle, siteConfig.selectors.rating),
            reviews: await this.extractText(handle, siteConfig.selectors.reviews),
            source: siteConfig.name,
          };
        } catch (error) {
          utils.log(`Error extrayendo producto: ${error.message}`, 'warning');
          return null;
        }
      })
    );
  }

  async extractText(element, selector) {
    try {
      const text = await element.$eval(selector, (el) => el.textContent);
      return utils.sanitizeText(text);
    } catch (error) {
      return 'N/A';
    }
  }

  async extractAttribute(element, selector, attribute) {
    try {
      return await element.$eval(selector, (el, attr) => el.getAttribute(attr), attribute);
    } catch (error) {
      return 'N/A';
    }
  }

  async goToNextPage(siteConfig) {
    if (!siteConfig.nextPage) return false;

    try {
      const nextPageButton = await this.page.$(siteConfig.nextPage);
      if (nextPageButton) {
        await nextPageButton.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        return true;
      }
    } catch (error) {
      utils.log(`Error navegando a página siguiente: ${error.message}`, 'warning');
    }
    return false;
  }

  categorize(product) {
    const reviews = parseInt(product.reviews.replace(/\D/g, '')) || 0;
    const rating = parseFloat(product.rating.split(' ')[0]) || 0;

    if (product.title.includes('solución') || product.title.includes('problema') || product.title.includes('ayuda')) {
      return '🌟 Soluciones Especiales';
    } else if (reviews > 100000 && rating >= 4.8) {
      return '🔥 Mejores Ventas';
    } else if (reviews > 50000 && rating >= 4.5) {
      return '✨ Tendencias';
    } else if (reviews > 10000 && rating >= 4.0) {
      return '⭐ Populares';
    } else {
      return '📌 Otros';
    }
  }

  generateMarkdown() {
    let markdown = `# Reporte de Productos\n\n_Actualizado: ${new Date().toLocaleString()}_\n\n`;
    const categories = {};

    this.products
      .filter((p) => p)
      .forEach((product) => {
        const category = this.categorize(product);
        categories[category] = categories[category] || [];
        categories[category].push(product);
      });

    for (const [category, products] of Object.entries(categories)) {
      markdown += `\n## ${category}\n\n`;
      products.forEach((p) => {
        markdown += `### ${p.title}\n` +
          `- **Fuente:** ${p.source}\n` +
          `- **Precio:** ${p.price}\n` +
          `- **Valoración:** ${p.rating} (${p.reviews} reseñas)\n` +
          `- [Ver producto](${p.link}) | [Ver imagen](${p.image})\n\n`;
      });
    }

    fs.writeFileSync(config.outputFile, markdown);
    utils.log(`Reporte generado: ${config.outputFile}`);
  }

  async close() {
    await this.browser.close();
  }
}

// Ejecución principal
(async () => {
  const scraper = new Scraper();
  try {
    await scraper.initialize();

    for (const site of Object.values(sites)) {
      await scraper.scrapeSite(site);
      await utils.delay(5000); // Espera entre sitios
    }

    scraper.generateMarkdown();
  } catch (error) {
    utils.log(`Error crítico: ${error.message}`, 'error');
  } finally {
    await scraper.close();
  }
})();