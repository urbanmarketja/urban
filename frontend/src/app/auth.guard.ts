import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccountRole } from './market-data';
import { AuthService } from './auth.service';

export const requireAuth: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser();
  const roles = route.data['roles'] as AccountRole[] | undefined;

  if (!user) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  if (roles?.length && !roles.includes(user.role)) {
    return router.createUrlTree([user.role === 'admin' ? '/admin' : user.role === 'vendor' ? '/vendor-dashboard' : '/user-dashboard']);
  }

  return true;
};
