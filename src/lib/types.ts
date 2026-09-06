export type ListKind = "general" | "shop" | "watch";
export type GroupBy = "service" | "aisle" | "due" | null;

export type List = {
  id: string;
  household_id: string;
  name: string;
  /** The pill label. Several lists can share one, e.g. both TV lists. */
  group_name: string;
  position: number;
  /** Null means shared with the whole household. */
  private_to: string | null;
  group_by: GroupBy;
  auto_clear: boolean;
  show_done: boolean;
  is_archive: boolean;
  kind: ListKind;
  /** Where a promote button sends an item, and what that button says. */
  promote_to: string | null;
  promote_label: string | null;
  /** Where a ticked item goes, e.g. Watching now -> Watched. */
  done_to: string | null;
};

export type Item = {
  id: string;
  list_id: string;
  text: string;
  done: boolean;
  created_at: string;
  created_by: string | null;
  done_by: string | null;
  done_at: string | null;
  qty: string | null;
  aisle: string | null;
  service: string | null;
  progress: string | null;
  profile: string | null;
  suggested_by: string | null;
  hidden_until: string | null;
  archived_at: string | null;
  /** When it should be done by. Drives the Today / This week grouping. */
  due_on: string | null;
};

export type Household = {
  id: string;
  name: string;
  services: string[];
  profiles: string[];
  aisle_order: string[];
};

export type Member = {
  household_id: string;
  user_id: string;
  initials: string | null;
  is_owner: boolean;
};

export type AllowedEmail = {
  id: string;
  email: string;
};

/** What the capture endpoint decided a piece of dictation meant. */
export type CaptureResult =
  | { intent: "add"; items: NewItem[] }
  | { intent: "update"; updates: ItemUpdate[] }
  | { intent: "ask"; answer: string }
  | { intent: "do"; action: CaptureAction };

export type NewItem = {
  text: string;
  list_id: string;
  qty: string | null;
  aisle: string | null;
  service: string | null;
  progress: string | null;
  profile: string | null;
  suggested_by: string | null;
  due_on: string | null;
};

export type ItemUpdate = {
  item_id: string;
  text: string | null;
  qty: string | null;
  service: string | null;
  progress: string | null;
  profile: string | null;
  due_on: string | null;
  done: boolean | null;
};

export type CaptureAction = {
  type: "read_aloud" | "email" | "none";
  list_ids: string[];
  needs_confirmation: boolean;
};
