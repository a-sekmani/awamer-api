-- CreateEnum
CREATE TYPE "marketing_owner_type" AS ENUM ('path', 'course');

-- CreateEnum
CREATE TYPE "testimonial_status" AS ENUM ('pending', 'approved', 'hidden');

-- CreateEnum
CREATE TYPE "course_enrollment_status" AS ENUM ('active', 'completed', 'dropped');

-- CreateEnum
CREATE TYPE "certificate_type" AS ENUM ('path', 'course');

-- CreateEnum
CREATE TYPE "course_level" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "tag_status" AS ENUM ('active', 'hidden');

-- DropIndex
DROP INDEX "last_positions_userId_pathId_key";

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "type" "certificate_type" NOT NULL,
ALTER COLUMN "pathId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" "course_level",
ADD COLUMN     "skills" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "slug" TEXT NOT NULL,
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "thumbnail" TEXT,
ALTER COLUMN "pathId" DROP NOT NULL,
ALTER COLUMN "order" DROP NOT NULL,
ALTER COLUMN "order" DROP DEFAULT;

-- AlterTable
ALTER TABLE "last_positions" ALTER COLUMN "pathId" DROP NOT NULL,
ALTER COLUMN "courseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "paths" ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promoVideoThumbnail" TEXT,
ADD COLUMN     "promoVideoUrl" TEXT,
ADD COLUMN     "skills" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tag_status" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "path_tags" (
    "pathId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "path_tags_pkey" PRIMARY KEY ("pathId","tagId")
);

-- CreateTable
CREATE TABLE "course_tags" (
    "courseId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "course_tags_pkey" PRIMARY KEY ("courseId","tagId")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "ownerType" "marketing_owner_type" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "ownerType" "marketing_owner_type" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "ownerType" "marketing_owner_type" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorTitle" TEXT,
    "avatarUrl" TEXT,
    "content" TEXT NOT NULL,
    "rating" INTEGER,
    "status" "testimonial_status" NOT NULL DEFAULT 'pending',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "course_enrollment_status" NOT NULL DEFAULT 'active',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "tags_status_idx" ON "tags"("status");

-- CreateIndex
CREATE INDEX "path_tags_tagId_idx" ON "path_tags"("tagId");

-- CreateIndex
CREATE INDEX "course_tags_tagId_idx" ON "course_tags"("tagId");

-- CreateIndex
CREATE INDEX "features_ownerType_ownerId_idx" ON "features"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "faqs_ownerType_ownerId_idx" ON "faqs"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "testimonials_ownerType_ownerId_idx" ON "testimonials"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "testimonials_status_idx" ON "testimonials"("status");

-- CreateIndex
CREATE INDEX "course_enrollments_userId_idx" ON "course_enrollments"("userId");

-- CreateIndex
CREATE INDEX "course_enrollments_courseId_idx" ON "course_enrollments"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_userId_courseId_key" ON "course_enrollments"("userId", "courseId");

-- CreateIndex
CREATE INDEX "certificates_type_idx" ON "certificates"("type");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_categoryId_idx" ON "courses"("categoryId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_tags" ADD CONSTRAINT "path_tags_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_tags" ADD CONSTRAINT "path_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_tags" ADD CONSTRAINT "course_tags_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_tags" ADD CONSTRAINT "course_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- KAN-70: Certificate must point to exactly one of pathId or courseId,
-- and the type discriminator must match the populated column.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_exactly_one_target"
  CHECK (
    ("pathId" IS NOT NULL AND "courseId" IS NULL AND "type" = 'path')
    OR
    ("pathId" IS NULL AND "courseId" IS NOT NULL AND "type" = 'course')
  );

-- KAN-70: LastPosition must be scoped to exactly one of pathId or courseId.
ALTER TABLE "last_positions"
  ADD CONSTRAINT "last_positions_exactly_one_scope"
  CHECK (
    ("pathId" IS NOT NULL AND "courseId" IS NULL)
    OR
    ("pathId" IS NULL AND "courseId" IS NOT NULL)
  );

-- KAN-70: a user may have at most one path-level certificate per path.
CREATE UNIQUE INDEX "certificates_user_path_unique"
  ON "certificates" ("userId", "pathId")
  WHERE "pathId" IS NOT NULL;

-- KAN-70: a user may have at most one course-level certificate per course.
CREATE UNIQUE INDEX "certificates_user_course_unique"
  ON "certificates" ("userId", "courseId")
  WHERE "courseId" IS NOT NULL;

-- KAN-70: a user may have at most one LastPosition per path enrollment.
CREATE UNIQUE INDEX "last_positions_user_path_unique"
  ON "last_positions" ("userId", "pathId")
  WHERE "pathId" IS NOT NULL;

-- KAN-70: a user may have at most one LastPosition per standalone course enrollment.
CREATE UNIQUE INDEX "last_positions_user_course_unique"
  ON "last_positions" ("userId", "courseId")
  WHERE "courseId" IS NOT NULL;
