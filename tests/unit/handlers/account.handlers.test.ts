import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

// Dynamic imports after mock setup
const { createQuickbooksAccount } = await import('../../../src/handlers/create-quickbooks-account.handler');
const { updateQuickbooksAccount } = await import('../../../src/handlers/update-quickbooks-account.handler');

describe('Account Handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('createQuickbooksAccount', () => {
    it('creates a top-level account (no parent) without SubAccount/ParentRef', async () => {
      let captured: any;
      const created = { Id: '500', Name: 'Office Supplies', SubAccount: false };
      mockQuickBooksInstance.createAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, created);
      });

      const result = await createQuickbooksAccount({ name: 'Office Supplies', type: 'Expense' });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual(created);
      // No parent supplied → these must be absent
      expect(captured.SubAccount).toBeUndefined();
      expect(captured.ParentRef).toBeUndefined();
    });

    it('creates a sub-account when parent_id is supplied (SubAccount:true + ParentRef object)', async () => {
      let captured: any;
      const created = {
        Id: '501',
        Name: 'Marketing Subscriptions',
        SubAccount: true,
        ParentRef: { value: '400' },
        FullyQualifiedName: 'Marketing:Marketing Subscriptions',
      };
      mockQuickBooksInstance.createAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, created);
      });

      const result = await createQuickbooksAccount({
        name: 'Marketing Subscriptions',
        type: 'Expense',
        sub_type: 'OtherMiscellaneousServiceCost',
        parent_id: '400',
      });

      expect(result.isError).toBe(false);
      // The nested ParentRef must be a reference OBJECT, never the string "[object Object]"
      expect(captured.SubAccount).toBe(true);
      expect(captured.ParentRef).toEqual({ value: '400' });
      expect(typeof captured.ParentRef).toBe('object');
    });

    it('propagates QBO errors', async () => {
      mockQuickBooksInstance.createAccount.mockImplementation((_payload: any, cb: any) =>
        cb(new Error('Duplicate name'), null)
      );

      const result = await createQuickbooksAccount({ name: 'Dup', type: 'Expense' });

      expect(result.isError).toBe(true);
    });

    it('returns isError when the client cannot be obtained', async () => {
      mockQuickbooksClientClass.getInstance.mockRejectedValueOnce(new Error('no client') as never);

      const result = await createQuickbooksAccount({ name: 'X', type: 'Expense' });

      expect(result.isError).toBe(true);
    });
  });

  describe('updateQuickbooksAccount (re-parent)', () => {
    it('sends ParentRef as a reference object and never sets sparse', async () => {
      const existing = {
        Id: '393',
        Name: 'Rental Income Unit A',
        AccountType: 'Income',
        AccountSubType: 'ServiceFeeIncome',
        Classification: 'Revenue',
        SubAccount: false,
        SyncToken: '0',
        sparse: false,
      };
      let captured: any;
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(null, existing));
      mockQuickBooksInstance.updateAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, { ...existing, SubAccount: true, ParentRef: { value: '300' }, SyncToken: '1' });
      });

      const result = await updateQuickbooksAccount({
        account_id: '393',
        patch: { SubAccount: true, ParentRef: { value: '300' } },
      });

      expect(result.isError).toBe(false);
      // ParentRef survives as an object (regression guard for the "[object Object]" bug)
      expect(captured.ParentRef).toEqual({ value: '300' });
      expect(typeof captured.ParentRef).toBe('object');
      expect(captured.SubAccount).toBe(true);
      // Account entity does not support sparse updates → must NOT be set
      expect(captured.sparse).toBeUndefined();
      // Full-object update carries the existing Name/type through
      expect(captured.Name).toBe('Rental Income Unit A');
      expect(captured.AccountType).toBe('Income');
    });

    it('accepts a bare-string ParentRef and coerces it to the object shape', async () => {
      const existing = { Id: '393', Name: 'X', AccountType: 'Income', SyncToken: '0' };
      let captured: any;
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(null, existing));
      mockQuickBooksInstance.updateAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, existing);
      });

      await updateQuickbooksAccount({ account_id: '393', patch: { SubAccount: true, ParentRef: '300' } });

      expect(captured.ParentRef).toEqual({ value: '300' });
    });

    it('normalizes scalar field types and passes unknown keys through', async () => {
      const existing = { Id: '393', Name: 'X', SyncToken: '0' };
      let captured: any;
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(null, existing));
      mockQuickBooksInstance.updateAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, existing);
      });

      await updateQuickbooksAccount({
        account_id: '393',
        patch: {
          Name: 12345,            // number -> coerced to string
          Active: 'true',          // string -> coerced to boolean true
          CurrentBalance: '42',    // string -> coerced to number
          AcctNum: '4000',         // unknown key -> passthrough untouched
          Description: undefined,  // undefined -> skipped
        },
      });

      expect(captured.Name).toBe('12345');
      expect(captured.Active).toBe(true);
      expect(captured.CurrentBalance).toBe(42);
      expect(captured.AcctNum).toBe('4000');
      expect('Description' in captured).toBe(false);
    });

    it('coerces non-"true" string Active to boolean false', async () => {
      const existing = { Id: '393', Name: 'X', SyncToken: '0' };
      let captured: any;
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(null, existing));
      mockQuickBooksInstance.updateAccount.mockImplementation((payload: any, cb: any) => {
        captured = payload;
        cb(null, existing);
      });

      await updateQuickbooksAccount({
        account_id: '393',
        patch: { Active: false, CurrentBalance: 100 }, // already-boolean / already-number arms
      });

      expect(captured.Active).toBe(false);
      expect(captured.CurrentBalance).toBe(100);
    });

    it('returns isError when getAccount fails', async () => {
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(new Error('not found'), null));

      const result = await updateQuickbooksAccount({ account_id: '999', patch: { Name: 'Y' } });

      expect(result.isError).toBe(true);
    });

    it('returns isError when updateAccount fails', async () => {
      const existing = { Id: '393', Name: 'X', SyncToken: '0' };
      mockQuickBooksInstance.getAccount.mockImplementation((_id: any, cb: any) => cb(null, existing));
      mockQuickBooksInstance.updateAccount.mockImplementation((_payload: any, cb: any) => cb(new Error('stale'), null));

      const result = await updateQuickbooksAccount({ account_id: '393', patch: { Name: 'Y' } });

      expect(result.isError).toBe(true);
    });
  });
});
