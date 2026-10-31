// Stable cloud review server: editing documentation or tsconfig must not reload
// a browser in the middle of a native render/readback comparison.
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: null, hmr: false } });
await server.listen();
server.printUrls();
