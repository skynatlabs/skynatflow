-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "recoverable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveredOnId" TEXT;

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "detentionBilledOnId" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "subcontractorId" TEXT;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

