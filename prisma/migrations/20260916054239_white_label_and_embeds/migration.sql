-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "brandAccent" TEXT,
ADD COLUMN     "brandDomain" TEXT,
ADD COLUMN     "brandDomainVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "brandLogoUrl" TEXT,
ADD COLUMN     "embedAllowedHosts" TEXT,
ADD COLUMN     "hidePlatformBranding" BOOLEAN NOT NULL DEFAULT false;

