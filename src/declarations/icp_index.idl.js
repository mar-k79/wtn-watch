// Minimal ICP index canister (qhbym-qaaaa-aaaaa-aaafq-cai) interface — only what WTN Watch reads.
// Records are subtypes (fewer fields is fine in Candid); every Operation tag is listed so decoding never fails.
export const idlFactory = ({ IDL }) => {
  const Tokens = IDL.Record({ e8s: IDL.Nat64 });
  const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
  const Operation = IDL.Variant({
    Approve: IDL.Record({}),
    Burn: IDL.Record({ from: IDL.Text, amount: Tokens }),
    Mint: IDL.Record({ to: IDL.Text, amount: Tokens }),
    Transfer: IDL.Record({ to: IDL.Text, from: IDL.Text, amount: Tokens, fee: Tokens }),
    TransferFrom: IDL.Record({ to: IDL.Text, from: IDL.Text, amount: Tokens, fee: Tokens }),
  });
  const Transaction = IDL.Record({ memo: IDL.Nat64, operation: Operation, timestamp: IDL.Opt(TimeStamp), created_at_time: IDL.Opt(TimeStamp) });
  const TransactionWithId = IDL.Record({ id: IDL.Nat64, transaction: Transaction });
  const Ok = IDL.Record({ balance: IDL.Nat64, transactions: IDL.Vec(TransactionWithId), oldest_tx_id: IDL.Opt(IDL.Nat64) });
  const Args = IDL.Record({ max_results: IDL.Nat64, start: IDL.Opt(IDL.Nat64), account_identifier: IDL.Text });
  return IDL.Service({
    get_account_identifier_transactions: IDL.Func([Args], [IDL.Variant({ Ok, Err: IDL.Record({ message: IDL.Text }) })], ['query']),
  });
};
