// ownerid.js -- the single-user constant behind the multi-user-aware design
// (NEXT-RELEASE points 10 and 25). Every record the UTS-shaped surfaces write
// carries an ownerId so the subscriber-database migration is a backfill, not a
// re-model. Today there is exactly one owner; nothing may branch on this value.
module.exports = { OWNER_ID: 'owner' };
