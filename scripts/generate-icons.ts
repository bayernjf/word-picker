import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, 'assets', 'icons');

interface IconSet {
  name: string;
  src: string;
  sizes: number[];
  outputDir: string;
  filenamePattern: (size: number) => string;
}

const PICKER_SIZES = [16, 32, 48, 128];

const iconSets: IconSet[] = [
  {
    name: 'wordpicker',
    src: path.join(ICONS_DIR, 'wordpicker-logo-full.svg'),
    sizes: PICKER_SIZES,
    outputDir: ICONS_DIR,
    filenamePattern: (size) => `icon${size}.png`,
  },
  {
    name: 'wordpicker-mac-menubar',
    src: path.join(ICONS_DIR, 'wordpicker-mac-menubar-template.svg'),
    sizes: [18, 36],
    outputDir: ICONS_DIR,
    filenamePattern: (size) => `wordpicker-menubar-${size}px.png`,
  },
];

async function generateIconSet(iconSet: IconSet): Promise<void> {
  console.log(`\n[generate-icons] Generating ${iconSet.name} icons...`);

  if (!fs.existsSync(iconSet.src)) {
    console.error(`  ✗ Source SVG not found: ${iconSet.src}`);
    process.exit(1);
  }

  fs.mkdirSync(iconSet.outputDir, { recursive: true });

  for (const size of iconSet.sizes) {
    const filename = iconSet.filenamePattern(size);
    const outputPath = path.join(iconSet.outputDir, filename);

    await sharp(iconSet.src)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`  ✓ ${filename} (${size}x${size})`);
  }
}

async function main(): Promise<void> {
  console.log('[generate-icons] Starting icon generation...');

  for (const iconSet of iconSets) {
    await generateIconSet(iconSet);
  }

  console.log('\n[generate-icons] All icons generated successfully!');
}

main().catch((err) => {
  console.error('[generate-icons] Error:', err);
  process.exit(1);
});
