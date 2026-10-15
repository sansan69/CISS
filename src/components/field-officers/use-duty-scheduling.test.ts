import { describe, expect, it, vi } from 'vitest';
import { scopedDutyOrdersReducer, type ScopedDutyOrdersState } from './use-duty-scheduling';

vi.mock('@/context/auth-context', () => ({ useAppAuth: () => ({ userRole: 'fieldOfficer' }) }));
vi.mock('@/lib/api-client', () => ({ authorizedFetch: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));

describe('scoped work-order loading state', () => {
  it('clears loading, errors, and stale orders when disabled during a pending request', () => {
    const pending: ScopedDutyOrdersState = {
      orders: [{
        id: 'stale-order', siteId: 'site', siteName: 'Fixture site', clientName: 'Fixture client',
        district: 'Fixture district', date: '2026-10-20', examName: 'Fixture exam', examCode: 'EX-1',
        maleGuardsRequired: 1, femaleGuardsRequired: 0, totalManpower: 1, assignedGuards: [],
        assignmentReviewRequired: false, assignmentStatus: 'pending', willingCount: 0, unavailableCount: 0,
      }],
      loading: true,
      error: 'Previous load error',
    };

    expect(scopedDutyOrdersReducer(pending, { type: 'disabled' })).toEqual({
      orders: [],
      loading: false,
      error: '',
    });
  });
});
