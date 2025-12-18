import puppeteer from 'puppeteer';


class PDFService {
  constructor() {
    this.browser = null;
    this.initialized = false;
    this.initializationPromise = null;
  }

  async initBrowser() {
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        console.log('🚀 Launching Puppeteer...');
        
        const launchOptions = {
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--disable-extensions',
            '--disable-web-resources'
          ],
          defaultViewport: { width: 1920, height: 1080 },
          timeout: 60000
        };

        // Try with explicit path first if provided
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
          launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }

        this.browser = await puppeteer.launch(launchOptions);

        this.initialized = true;
        console.log('✅ Puppeteer ready');
        
        // Handle browser disconnect
        this.browser.on('disconnected', () => {
          console.log('⚠️ Browser disconnected');
          this.initialized = false;
          this.browser = null;
          this.initializationPromise = null;
        });

      } catch (error) {
        console.error('❌ Failed to launch Puppeteer:', error.message);
        console.error('Stack:', error.stack);
        this.initializationPromise = null;
        this.initialized = false;
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  async ensureInitialized() {
    if (!this.initialized || !this.browser || !this.browser.isConnected()) {
      this.initializationPromise = null; // Reset promise if browser is not connected
      await this.initBrowser();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }
    return this.initialized;
  }

  async getBrowser() {
    await this.ensureInitialized();
    return this.browser;
  }

  async generatePDF(htmlContent, options = {}) {
    console.log('🚀 Starting PDF generation...');
    console.log(`📊 HTML size: ${(htmlContent.length / 1024).toFixed(2)} KB`);
    
    let browser = null;
    let page = null;
    
    try {
      // Get or create browser
      console.log('📋 Getting browser instance...');
      browser = await this.getBrowser();
      console.log('✅ Browser acquired');
      
      // Create a fresh page for each request
      console.log('📄 Creating new page...');
      page = await browser.newPage();
      console.log('✅ Page created');
      
      // Prepare HTML (removes problematic elements)
      console.log('🧹 Preparing HTML...');
      const processedHTML = this.prepareHTMLForPDF(htmlContent);
      console.log(`✅ HTML prepared: ${processedHTML.length} chars`);
      
      console.log('📝 Setting HTML content...');
      
      // Set content with timeout
      await page.setContent(processedHTML, {
        waitUntil: 'domcontentloaded',
        timeout: 100000 // Increased timeout for large content
      });
      
      console.log('✅ HTML content loaded');
      
      // Wait for rendering
      console.log('⏳ Waiting for page render...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('✅ Page rendered');
      
      // Set page format based on options
      const format = options.format || 'custom'; // custom or a4
      const margin = options.margin || { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' };
      
      console.log(`📐 Generating PDF with format: ${format}`);
      
      let pdfOptions = {
        printBackground: true,
        margin: margin,
        displayHeaderFooter: false,
        preferCSSPageSize: false,
        timeout: 100000 // Increased timeout for large PDFs
      };
      
      // Apply format
      if (format === 'custom') {
        // Custom format: 279.4mm x 157.1mm (landscape)
        pdfOptions.width = '279.4mm';
        pdfOptions.height = '157.1mm';
        pdfOptions.landscape = false; // Already set by dimensions
      } else {
        // A4 landscape
        pdfOptions.format = 'A4';
        pdfOptions.landscape = true;
      }
      
      console.log('📄 Generating PDF buffer...');
      console.log('PDF Options:', JSON.stringify(pdfOptions, null, 2));
      const pdfBuffer = await page.pdf(pdfOptions);
      
      console.log(`✅ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      return pdfBuffer;
      
    } catch (error) {
      console.error('❌ PDF generation error:', error.message);
      console.error('❌ Full error:', error);
      console.error('❌ Stack:', error.stack);
      
      // Try with fresh browser instance
      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
        this.browser = null;
        this.initialized = false;
      }
      
      throw error;
      
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('Error closing page:', e.message);
        }
      }
    }
  }

  // Method for A4 format (for backward compatibility)
  async generatePDFWithA4(htmlContent) {
    console.log('🔄 Generating PDF with A4 format...');
    return this.generatePDF(htmlContent, { format: 'a4' });
  }

  // Method for custom format
  async generatePDFWithCustomFormat(htmlContent) {
    console.log('📐 Generating PDF with custom format...');
    return this.generatePDF(htmlContent, { format: 'custom' });
  }

  prepareHTMLForPDF(htmlContent) {
    console.log('🧹 Preparing HTML for PDF generation...');
    
    let processed = htmlContent;
    
    // 1. Ensure DOCTYPE
    if (!processed.includes('<!DOCTYPE')) {
      processed = '<!DOCTYPE html>' + processed;
    }
    
    // 2. Ensure complete HTML structure
    if (!processed.includes('<html')) {
      processed = '<html><head><meta charset="UTF-8"></head><body>' + processed + '</body></html>';
    }
    
    // 3. Add CSS for better PDF rendering
    const pdfCSS = `
      <style>
        /* Optimize for PDF printing */
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
          padding: 10px;
        }
        
        /* Page break handling */
        .page-break {
          page-break-after: always;
        }
        
        .avoid-break {
          page-break-inside: avoid;
        }
        
        /* Tables */
        table {
          border-collapse: collapse;
          width: 100%;
          margin-bottom: 10px;
          page-break-inside: auto;
        }
        
        tr {
          page-break-inside: avoid;
          page-break-after: auto;
        }
        
        th, td {
          border: 1px solid #ddd;
          padding: 6px;
          text-align: left;
          vertical-align: top;
          page-break-inside: auto;
        }
        
        /* Images */
        img {
          max-width: 100%;
          height: auto;
        }
        
        /* Custom format specific */
        @media print {
          body {
            font-size: 11px;
          }
        }
      </style>
    `;
    
    // Add CSS to head
    if (processed.includes('</head>')) {
      processed = processed.replace('</head>', pdfCSS + '</head>');
    } else if (processed.includes('<body>')) {
      processed = processed.replace('<body>', '<head>' + pdfCSS + '</head><body>');
    }
    
    console.log(`📊 HTML processed: ${htmlContent.length} → ${processed.length} chars`);
    return processed;
  }

  async cleanup() {
    console.log('🧹 Cleaning up PDF service...');
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('✅ Browser closed');
      } catch (error) {
        console.error('❌ Error closing browser:', error);
      }
      this.browser = null;
      this.initialized = false;
      this.initializationPromise = null;
    }
  }
}

// Export instance
const pdfServiceInstance = new PDFService();
export { PDFService };
export default pdfServiceInstance;