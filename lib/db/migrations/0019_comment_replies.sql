ALTER TABLE "comments" ADD COLUMN "parent_comment_id" integer;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_comments_parent_comment" ON "comments" USING btree ("parent_comment_id");
