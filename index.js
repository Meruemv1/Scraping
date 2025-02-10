import fs from 'fs/promises';
import puppeteer from 'puppeteer';
import xlsx from 'xlsx';

(async () => {
    // Inicializa Puppeteer
    const browser = await puppeteer.launch({ headless: false }); // headless: true para modo sin ventana
    const page = await browser.newPage();

    // Navega a la página de los productos más vendidos
    await page.goto('https://www.amazon.es/gp/bestsellers');

    // Aceptar cookies
    try {
        await page.waitForSelector('#a-autoid-0-announce', { visible: true, timeout: 20000 }); // Aumenta el tiempo de espera
        await page.click('#a-autoid-0-announce'); // Cambia el selector según sea necesario
    } catch (error) {
        console.error('No se encontró el botón de aceptar cookies:', error);
    }

    try {
        // Espera a que los elementos de los productos carguen
        await page.waitForSelector('#CardInstancetPNmwym51CukZMa-iLBTaA > div > div > div > div.a-row.a-carousel-controls.a-carousel-row.a-carousel-has-buttons', { visible: true, timeout: 60000 });

        // Extrae la información de los productos
        const products = await page.$$eval('#CardInstancetPNmwym51CukZMa-iLBTaA > div > div > div > div.a-row.a-carousel-controls.a-carousel-row.a-carousel-has-buttons', (items) => {
            return items.map(item => {
                const position = item.querySelector('span.zg-badge-text')?.textContent.trim();
                const title = item.querySelector('div.p13n-sc-truncate-desktop-type2')?.textContent.trim();
                const rating = item.querySelector('class="a-icon a-icon-star-small a-star-small-4-5 aok-align-top"cls')?.textContent.trim();
                const reviews = item.querySelector('class="a-size-small"')?.textContent.trim();
                const price = item.querySelector('class="_cDEzb_p13n-sc-price_3mJ9Z"')?.textContent.trim();
                const link = item.querySelector('a.a-link-normal')?.getAttribute('href');

                return {
                    position,
                    title,
                    rating,
                    reviews,
                    price,
                    link: `https://www.amazon.es${link}`
                };
            }).filter(Boolean);
        });

        console.log(products);

        // Escribir en CSV
        let csv = 'Position,Title,Rating,Reviews,Price,Link\n';
        products.forEach(product => {
            csv += `${product.position},${product.title},${product.rating},${product.reviews},${product.price},${product.link}\n`;
        });
        await fs.writeFile('products.csv', csv);

        // Escribir en XLSX
        const ws = xlsx.utils.json_to_sheet(products);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Products');
        const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        await fs.writeFile('products.xlsx', xlsxBuffer);

    } catch (error) {
        console.error('Error extracting products:', error);
    } finally {
        await browser.close();
    }
})();