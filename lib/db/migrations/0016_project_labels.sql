CREATE TABLE "project_labels" (
	"project_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	CONSTRAINT "project_labels_project_id_label_id_pk" PRIMARY KEY("project_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "project_labels" ADD CONSTRAINT "project_labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_labels" ADD CONSTRAINT "project_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_labels_label" ON "project_labels" USING btree ("label_id");