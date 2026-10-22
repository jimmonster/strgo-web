import { mkdir, writeFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Lucide from 'lucide-react';

const { Eye, EyeOff, LogIn, ShieldCheck, WandSparkles, Images, Settings, RefreshCw, Lightbulb, Sparkles, CloudUpload, ImagePlus, Star, Save, Cloud, DatabaseBackup, UserPlus, Copy, X, RotateCcw, Download, Check, Clock, CircleAlert, Trash2, Pencil, Plus } = Lucide;

const icons = { eye: Eye, 'eye-off': EyeOff, 'log-in': LogIn, 'shield-check': ShieldCheck, 'wand-sparkles': WandSparkles, images: Images, settings: Settings, 'refresh-cw': RefreshCw, lightbulb: Lightbulb, sparkles: Sparkles, 'cloud-upload': CloudUpload, 'image-plus': ImagePlus, star: Star, save: Save, 'cloud-check': Cloud, 'database-backup': DatabaseBackup, 'user-plus': UserPlus, copy: Copy, x: X, 'rotate-ccw': RotateCcw, download: Download, check: Check, clock: Clock, 'circle-alert': CircleAlert, 'trash-2': Trash2, pencil: Pencil, plus: Plus };
await mkdir(new URL('../src/image-playground/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/image-playground/icons.js', import.meta.url), `// Generated from lucide-react (ISC license), run node scripts/image-icons.mjs.\nexport const icons = ${JSON.stringify(Object.fromEntries(Object.entries(icons).map(([name, Icon]) => [name, renderToStaticMarkup(React.createElement(Icon, { size: 20, strokeWidth: 1.7, 'aria-hidden': true }))])))};\n`);
