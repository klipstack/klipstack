import { data } from "react-router"

/**
 * Any URL no other route matches. Without it React Router answers the 404 itself and skips the root
 * loader, so the page would not know the reader is signed in, nor their theme.
 */
export function loader() {
	throw data(null, { status: 404 })
}

/** A form posted to an unknown URL is a 404 too, not a 405. */
export const action = loader

/** Never shown: the loader always throws, and the root's error boundary draws the page. A page, not a
    resource route, so the 404 is HTML. */
export default function NotFound() {
	return null
}
