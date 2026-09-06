/**
 * Legacy Grants.gov / watchlist / pursuit seeding was removed with migration
 * `20260413100000_remove_legacy_grants_gov_stack.sql`.
 *
 * Use the app: sync Simpler (NIH), optional legacy feature extract; fit results come from the nightly sweep.
 * Investigators: CSV pipeline in admin / investigators flows.
 */
import "dotenv/config";

async function main() {
  console.log(
    "No database seed rows are written by this script anymore.\n" +
      "After `supabase db push` (or apply migrations), sign in and sync funding data from the UI."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
