import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const m = require('./index.js');

export const load = m.load;
export const parseEnvText = m.parseEnvText;
export const resolveFile = m.resolveFile;
export const loadFromVault = m.loadFromVault;
export const findExe = m.findExe;
export default m;
