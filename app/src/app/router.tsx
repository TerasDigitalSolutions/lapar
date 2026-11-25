import { createHashRouter } from 'react-router';
import { Layout, NotFound, RouteError } from './Layout';

const lazy = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

export const router = createHashRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', lazy: lazy(() => import('../features/landing')) },
      { path: '/t/:token', lazy: lazy(() => import('../features/customer')) },
      { path: '/welcome', lazy: lazy(() => import('../features/auth')) },
      { path: '/pickup/:token', lazy: lazy(() => import('../features/pickup')) },
      { path: '/staff', lazy: lazy(() => import('../features/staff')) },
      { path: '/manage', lazy: lazy(() => import('../features/manager')) },
      { path: '/admin', lazy: lazy(() => import('../features/admin')) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
