-- AlterTable
ALTER TABLE "events" ADD COLUMN     "noShow" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "membership_involvements" ADD COLUMN     "renewalDueAt" TIMESTAMP(3);
