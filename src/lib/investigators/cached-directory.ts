/**
 * The Investigators directory, cached (2026-09-13, Vincent: "reduce this
 * load time"). Measured before: the page's one read, `loadDirectory`, cost
 * 6.5 s cold and 1.2 s warm against the live database — the evidence
 * function alone 4.6 s cold — and every visit paid it. The directory is
 * global (not team-scoped) and changes only when a person is added, edited,
 * archived or imported, or when a nightly ingest lands, so it is served
 * from Next's data cache for five minutes and revalidated by every write
 * that touches it (`revalidateDirectory`), the way the Review badges are.
 *
 * The cached function makes its own service-role client: a request-bound
 * client cannot be captured by `unstable_cache`. The read itself is the
 * public directory every signed-in user may see, so the key needs no user.
 */
import { revalidateTag, unstable_cache } from "next/cache";
import { loadDirectory } from "@/lib/investigators/directory";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const DIRECTORY_TAG = "investigator-directory";

const TTL_SECONDS = 5 * 60;

type Directory = Awaited<ReturnType<typeof loadDirectory>>;

const cachedDirectory = unstable_cache(
  async (): Promise<Directory | null> => {
    const admin = createServiceRoleClient();
    if (!admin) return null;
    return loadDirectory(admin);
  },
  ["investigator-directory"],
  { tags: [DIRECTORY_TAG], revalidate: TTL_SECONDS },
);

/** The directory from the data cache; the live read when no service-role client is configured. */
export async function getDirectory(fallback: () => Promise<Directory>): Promise<Directory> {
  const cached = await cachedDirectory();
  return cached ?? fallback();
}

/** Every write that changes what the directory shows calls this beside its `revalidatePath("/investigators")`. */
export function revalidateDirectory(): void {
  revalidateTag(DIRECTORY_TAG);
}
