import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'vendor/:slug/product/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'vendor/:slug',
    renderMode: RenderMode.Server
  },
  {
    path: 'services/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'jobs/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders/:id',
    renderMode: RenderMode.Server
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];
