import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";

/** Department pages: an unknown / hidden department or order is a plain 404 (nothing leaks). */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}
