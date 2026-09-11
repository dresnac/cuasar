ALTER TABLE "agencies" ADD COLUMN "clerk_org_id" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_clerkOrgId_unique" UNIQUE("clerk_org_id");