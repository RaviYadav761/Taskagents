import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTasklyUser } from "../src/utils/supabase.js";

describe("Supabase account profile mapping", () => {
  it("maps only the account fields Taskly needs", () => {
    const user = toTasklyUser({
      id: "supabase-user-id",
      email: "person@example.com",
      user_metadata: {
        full_name: "Person Example",
        avatar_url: "https://example.com/avatar.png",
        access_token: "must-not-be-copied",
      },
      password: "must-not-be-copied",
    });

    assert.deepEqual(user, {
      id: "supabase-user-id",
      email: "person@example.com",
      fullName: "Person Example",
      role: "Personal Workspace",
      avatar: "https://example.com/avatar.png",
    });
    assert.equal("password" in user, false);
    assert.equal("access_token" in user, false);
  });

  it("uses safe display defaults and rejects incomplete identities", () => {
    assert.deepEqual(toTasklyUser({ id: "id-1", email: "name@example.com" }), {
      id: "id-1",
      email: "name@example.com",
      fullName: "name",
      role: "Personal Workspace",
      avatar: "/assets/avatar.jpg",
    });
    assert.equal(toTasklyUser(null), null);
    assert.equal(toTasklyUser({ id: "id-1" }), null);
  });
});
