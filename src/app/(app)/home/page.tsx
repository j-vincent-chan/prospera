import { redirect } from "next/navigation";

/** Home is gone (decision N2): Discover is where the app opens. Bookmarks and emailed links to `/home` land there. */
export default function HomePage() {
  redirect("/review");
}
