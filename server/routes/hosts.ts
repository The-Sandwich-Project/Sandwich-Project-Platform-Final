import { Router } from 'express';
import type { RouterDependencies } from '../types';
import { sanitizeMiddleware } from '../middleware/sanitizer';
import { insertHostSchema, insertHostContactSchema } from '@shared/schema';
import { PERMISSIONS } from '@shared/auth-utils';
import { scrapeHostAvailability } from '../services/host-availability-scraper';
import {
  hostsErrorHandler,
  asyncHandler,
  createHostsError,
  validateId,
  validateRequired,
  HostsError,
} from './hosts/error-handler';
import { z } from 'zod';
import { AuditLogger } from '../audit-logger';
import { logger } from '../utils/production-safe-logger';
import { geocodeAddress } from '../utils/geocoding';
import {
  syncHostContactVolunteer,
  unlinkHostContactVolunteer,
} from '../services/host-contact-volunteer-sync';

// Normalize freeform contact role values to standardized ones
// Must match the client-side normalizeContactRole function
function normalizeContactRole(raw: string | null | undefined): string {
  if (!raw) return 'host';
  const lower = raw.toLowerCase().trim();
  if (lower === 'lead') return 'lead';
  if (lower === 'primary' || lower === 'primary contact') return 'primary';
  if (lower === 'alternate' || lower === 'alternate contact') return 'alternate';
  if (lower === 'volunteer') return 'volunteer';
  if (lower.includes('host')) return 'host';
  return 'host';
}

export function createHostsRouter(deps: RouterDependencies) {
  const router = Router();
  const { storage, requirePermission } = deps;

  // Validation schema for coordinate updates
  const coordinatesSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  });

  // Host management routes
  router.get('/hosts', 
  requirePermission(PERMISSIONS.HOSTS_VIEW), 
  asyncHandler(async (req, res) => {
    const hosts = await storage.getAllHosts();
    res.json(hosts);
  })
);

  router.get(
  '/hosts-with-contacts',
  requirePermission(PERMISSIONS.HOSTS_VIEW),
  asyncHandler(async (req, res) => {
    const hostsWithContacts = await storage.getAllHostsWithContacts();
    res.json(hostsWithContacts);
  })
);

// Export hosts and contacts as CSV - MUST come before /:id route
  router.get(
    '/hosts/export-csv',
    requirePermission(PERMISSIONS.HOSTS_VIEW),
    asyncHandler(async (req, res) => {
      const hostsWithContacts = await storage.getAllHostsWithContacts();

      // CSV headers - one row per contact, with host info repeated
      const headers = [
        'Host ID',
        'Host Name',
        'Host Address',
        'Host Status',
        'Host Notes',
        'Contact ID',
        'Contact Name',
        'Contact Role',
        'Contact Phone',
        'Contact Email',
        'Contact Address',
        'Host Location',
        'Is Primary',
        'Weekly Active',
        'Driver Agreement Signed',
        'Van Approved',
        'Created At',
      ];

      const rows: string[][] = [];

      for (const host of hostsWithContacts) {
        if (host.status === 'hidden') continue;

        if (host.contacts.length === 0) {
          // Include hosts with no contacts as a single row
          rows.push([
            String(host.id),
            host.name || '',
            host.address || '',
            host.status || '',
            host.notes || '',
            '', '', '', '', '', '', '', '', '', '', '',
            host.createdAt ? new Date(host.createdAt).toISOString().split('T')[0] : '',
          ]);
        } else {
          for (const contact of host.contacts) {
            rows.push([
              String(host.id),
              host.name || '',
              host.address || '',
              host.status || '',
              host.notes || '',
              String(contact.id),
              contact.name || '',
              contact.role || '',
              contact.phone || '',
              contact.email || '',
              contact.address || '',
              contact.hostLocation || '',
              contact.isPrimary ? 'Yes' : 'No',
              contact.weeklyActive ? 'Yes' : 'No',
              contact.driverAgreementSigned ? 'Yes' : 'No',
              contact.vanApproved ? 'Yes' : 'No',
              host.createdAt ? new Date(host.createdAt).toISOString().split('T')[0] : '',
            ]);
          }
        }
      }

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...rows.map(row =>
          row.map(cell => {
            const cellStr = String(cell).replace(/"/g, '""');
            return cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')
              ? `"${cellStr}"`
              : cellStr;
          }).join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="hosts-export-${new Date().toISOString().split('T')[0]}.csv"`
      );
      res.send(csvContent);
    })
  );

  // Map endpoint - get host contacts with valid coordinates for map display.
  //
  // ONLY returns hosts whose status is exactly 'active'. Inactive hosts are
  // ineligible for driver planning by definition — coordinators mark a host
  // inactive precisely to remove it from active operations (collection log
  // dropdown, driver routes, etc.). Including them here would let a
  // coordinator accidentally route sandwiches to a location that shouldn't
  // be receiving them. 'hidden' is also excluded (soft-delete tier).
  //
  // Contacts within an active host that carry 'former_host' role also drop
  // out — they're historical directory entries, not usable route stops.
  router.get(
  '/hosts/map',
  requirePermission(PERMISSIONS.HOSTS_VIEW),
  asyncHandler(async (req, res) => {
    const hostsWithContacts = await storage.getAllHostsWithContacts();

    const mapData = hostsWithContacts
      .filter(host => host.status === 'active')
      .flatMap(host =>
        host.contacts
          .filter(contact =>
            contact.latitude !== null &&
            contact.longitude !== null &&
            !(contact as any).isFormerHost
          )
          .map(contact => ({
            id: contact.id,
            contactName: contact.name,
            role: contact.role,
            hostLocationName: host.name,
            address: contact.address,
            latitude: contact.latitude,
            longitude: contact.longitude,
            email: contact.email,
            phone: contact.phone,
          }))
      );

    res.json(mapData);
  })
);

// Bulk geocode host contacts that have addresses but no coordinates
  // Regions are organizational groupings only — addresses belong to individual contacts
  // Pass ?force=true to re-geocode ALL records, even those that already have coordinates
  router.post(
  '/hosts/geocode-all',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    const allHostsWithContacts = await storage.getAllHostsWithContacts();

    const contactsToGeocode = allHostsWithContacts.flatMap((host) =>
      host.contacts.filter(
        (c) => c.address && c.address.trim() !== '' && (force || !c.latitude || !c.longitude)
      )
    );

    if (contactsToGeocode.length === 0) {
      res.json({
        message: 'All host contacts with addresses already have coordinates',
        hostsProcessed: 0,
        contactsProcessed: 0,
      });
      return;
    }

    // Return immediately, geocode in background
    res.json({
      message: `Geocoding ${contactsToGeocode.length} host contacts in background`,
      hostsProcessed: 0,
      contactsProcessed: contactsToGeocode.length,
    });

    (async () => {
      let contactsSuccess = 0;
      let contactsFailed = 0;

      for (const contact of contactsToGeocode) {
        try {
          const coords = await geocodeAddress(contact.address!);
          if (coords) {
            await storage.updateHostContact(contact.id, {
              latitude: coords.latitude,
              longitude: coords.longitude,
            });
            contactsSuccess++;
            logger.info(`✅ Bulk geocoded host contact ${contact.id}: ${contact.address}`);
          } else {
            contactsFailed++;
            logger.warn(`⚠️ Bulk geocode returned no results for contact ${contact.id}: ${contact.address}`);
          }
          // Rate limit between requests
          await new Promise((resolve) => setTimeout(resolve, 1100));
        } catch (err) {
          contactsFailed++;
          logger.error(`Failed to bulk geocode host contact ${contact.id}:`, err);
        }
      }

      logger.info(`🗺️ Bulk geocode complete: ${contactsSuccess}/${contactsToGeocode.length} host contacts`);
    })();
  })
);

  router.get(
  '/hosts/:id',
  requirePermission(PERMISSIONS.HOSTS_VIEW),
  asyncHandler(async (req, res) => {
    const id = validateId(req.params.id, 'host');
    const host = await storage.getHost(id);
    if (!host) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }
    res.json(host);
  })
);

  router.post(
  '/hosts',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  sanitizeMiddleware,
  asyncHandler(async (req: any, res) => {
    validateRequired(req.body, ['name'], 'host creation');

    const result = insertHostSchema.safeParse(req.body);
    if (!result.success) {
      throw createHostsError(
        'Invalid host data provided',
        400,
        'VALIDATION_ERROR',
        { validationErrors: result.error.errors }
      );
    }

    let host = await storage.createHost(result.data);

    // Audit log
    await AuditLogger.logCreate(
      'hosts',
      String(host.id),
      host,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    // Auto-geocode address SYNCHRONOUSLY so coordinates are set before response
    if (result.data.address) {
      try {
        const coords = await geocodeAddress(result.data.address);
        if (coords) {
          const updated = await storage.updateHost(host.id, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            geocodedAt: new Date(),
          });
          if (updated) {
            host = updated;
          }
          logger.info(`✅ Geocoded new host ${host.id}: ${result.data.address}`);
        } else {
          logger.warn(`⚠️ Geocoding returned no results for new host ${host.id}: ${result.data.address}`);
        }
      } catch (err) {
        logger.error(`Failed to geocode host ${host.id}:`, err);
      }
    }

    res.status(201).json(host);
  })
);

  router.patch(
  '/hosts/:id',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  sanitizeMiddleware,
  asyncHandler(async (req: any, res) => {
    const id = validateId(req.params.id, 'host');
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      throw createHostsError('No update data provided', 400, 'NO_UPDATE_DATA');
    }

    // Get old data before update
    const oldHost = await storage.getHost(id);
    if (!oldHost) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }

    const host = await storage.updateHost(id, updates);
    if (!host) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }

    // Audit log
    await AuditLogger.logEntityChange(
      'hosts',
      String(id),
      oldHost,
      host,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    // Re-geocode synchronously if address changed
    const addressChanged = updates.address && updates.address !== oldHost.address;
    let finalHost = host;
    if (addressChanged) {
      try {
        const coords = await geocodeAddress(updates.address);
        if (coords) {
          const updated = await storage.updateHost(id, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            geocodedAt: new Date(),
          });
          if (updated) {
            finalHost = updated;
          }
          logger.info(`✅ Re-geocoded host ${id}: ${updates.address}`);
        } else {
          logger.warn(`⚠️ Geocoding returned no results for host ${id}: ${updates.address}`);
        }
      } catch (err) {
        logger.error(`Failed to re-geocode host ${id}:`, err);
      }
    }

    res.json(finalHost);
  })
);

// Update host coordinates endpoint
  router.patch(
  '/hosts/:id/coordinates',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  sanitizeMiddleware,
  asyncHandler(async (req: any, res) => {
    const id = validateId(req.params.id, 'host');

    // Validate coordinates using Zod schema
    const result = coordinatesSchema.safeParse(req.body);
    if (!result.success) {
      throw createHostsError(
        'Invalid coordinates provided',
        400,
        'VALIDATION_ERROR',
        { validationErrors: result.error.errors }
      );
    }

    const { latitude, longitude } = result.data;

    // Get old data before update
    const oldHost = await storage.getHost(id);
    if (!oldHost) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }

    // Update host with new coordinates and set geocodedAt timestamp
    const host = await storage.updateHost(id, {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      geocodedAt: new Date(),
    });

    if (!host) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }

    // Audit log
    await AuditLogger.logEntityChange(
      'hosts',
      String(id),
      oldHost,
      host,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    res.json(host);
  })
);

  router.delete(
  '/hosts/:id',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  asyncHandler(async (req: any, res) => {
    const id = validateId(req.params.id, 'host');

    // Get old data before delete
    const oldHost = await storage.getHost(id);
    if (!oldHost) {
      throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
    }

    try {
      const success = await storage.deleteHost(id);
      if (!success) {
        throw createHostsError('Host not found', 404, 'HOST_NOT_FOUND', { hostId: id });
      }

      // Audit log
      await AuditLogger.logDelete(
        'hosts',
        String(id),
        oldHost,
        {
          userId: req.user?.id || req.session?.user?.id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          sessionId: req.sessionID
        }
      );

      res.status(204).send();
    } catch (error: unknown) {
      // Check if it's a constraint error (has associated records)
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as any).message === 'string' &&
        (error as any).message.includes('associated collection')
      ) {
        throw createHostsError(
          (error as any).message,
          409,
          'CONSTRAINT_VIOLATION',
          { hostId: id, constraintType: 'associated_records' }
        );
      }
      throw error; // Re-throw to be handled by error handler
    }
  })
);

// Host contact routes
  router.get(
  '/host-contacts',
  requirePermission(PERMISSIONS.HOSTS_VIEW),
  asyncHandler(async (req, res) => {
    const hostId = req.query.hostId
      ? parseInt(req.query.hostId as string)
      : undefined;
      
    if (hostId && isNaN(hostId)) {
      throw createHostsError('Invalid host ID in query', 400, 'INVALID_HOST_ID', { providedHostId: req.query.hostId });
    }
    
    if (hostId) {
      const contacts = await storage.getHostContacts(hostId);
      res.json(contacts);
    } else {
      // Return all host contacts with their host location name
      const hosts = await storage.getAllHostsWithContacts();
      const allContacts = hosts.flatMap((host) => 
        host.contacts.map(contact => ({
          id: contact.id,
          name: contact.name,
          hostLocationName: host.name,
          displayName: `${contact.name} (${host.name})`,
          role: contact.role,
          email: contact.email,
          phone: contact.phone,
          hostId: contact.hostId,
        }))
      );
      res.json(allContacts);
    }
  })
);

  router.post(
  '/host-contacts',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  sanitizeMiddleware,
  asyncHandler(async (req: any, res) => {
    validateRequired(req.body, ['name', 'role', 'phone', 'hostId'], 'host contact creation');

    // "Designate as Host" on the Volunteers page: link the new contact to this
    // exact volunteer instead of matching by name/phone/email.
    let linkVolunteerId: number | undefined;
    if (req.body.linkVolunteerId != null) {
      linkVolunteerId = validateId(String(req.body.linkVolunteerId), 'volunteer');
      const volunteer = await storage.getVolunteer(linkVolunteerId);
      if (!volunteer) {
        throw createHostsError('Volunteer not found', 404, 'VOLUNTEER_NOT_FOUND', { volunteerId: linkVolunteerId });
      }
      if (volunteer.hostContactId != null) {
        throw createHostsError(
          `${volunteer.name} is already linked to a host contact. Edit them on the Hosts page instead.`,
          409,
          'VOLUNTEER_ALREADY_HOST',
          { volunteerId: linkVolunteerId, hostContactId: volunteer.hostContactId }
        );
      }
      // They stay a volunteer: that's the point of designating them.
      req.body.isVolunteer = true;
    }
    delete req.body.linkVolunteerId;

    // Normalize role before validation
    if (req.body.role) {
      req.body.role = normalizeContactRole(req.body.role);
    }

    const result = insertHostContactSchema.safeParse(req.body);
    if (!result.success) {
      throw createHostsError(
        'Invalid host contact data provided',
        400,
        'VALIDATION_ERROR',
        { validationErrors: result.error.errors }
      );
    }

    const contact = await storage.createHostContact(result.data);

    // Audit log
    await AuditLogger.logCreate(
      'host_contacts',
      String(contact.id),
      contact,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    // Auto-geocode contact address SYNCHRONOUSLY so coordinates are set before response
    let finalContact = contact;
    if (result.data.address) {
      try {
        const coords = await geocodeAddress(result.data.address);
        if (coords) {
          const updated = await storage.updateHostContact(contact.id, {
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          if (updated) {
            finalContact = updated;
          }
          logger.info(`✅ Geocoded new host contact ${contact.id}: ${result.data.address}`);
        } else {
          logger.warn(`⚠️ Geocoding returned no results for contact ${contact.id}: ${result.data.address}`);
        }
      } catch (err) {
        logger.error(`Failed to geocode host contact ${contact.id}:`, err);
      }
    }

    // "Also a volunteer" → create/link their volunteer record
    await syncHostContactVolunteer(finalContact, { preferVolunteerId: linkVolunteerId });

    res.status(201).json(finalContact);
  })
);

  router.patch(
  '/host-contacts/:id',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  sanitizeMiddleware,
  asyncHandler(async (req: any, res) => {
    const id = validateId(req.params.id, 'host contact');
    const updates = req.body;

    // Normalize role on update
    if (updates.role) {
      updates.role = normalizeContactRole(updates.role);
    }

    logger.info(`Updating host contact ${id} with data:`, updates);

    if (!updates || Object.keys(updates).length === 0) {
      throw createHostsError('No update data provided', 400, 'NO_UPDATE_DATA');
    }

    // Get old data before update
    const oldContact = await storage.getHostContact(id);
    if (!oldContact) {
      throw createHostsError('Host contact not found', 404, 'HOST_CONTACT_NOT_FOUND', { contactId: id });
    }

    let contact;
    try {
      contact = await storage.updateHostContact(id, updates);
    } catch (dbError: any) {
      logger.error(`Database error updating host contact ${id}:`, {
        error: dbError,
        errorMessage: dbError.message,
        errorStack: dbError.stack,
        updates: updates,
        updateKeys: Object.keys(updates)
      });
      throw createHostsError(
        `Database error: ${dbError.message || 'Unknown database error'}`,
        500,
        'DATABASE_ERROR',
        { originalError: dbError.message, errorStack: dbError.stack, updates }
      );
    }

    if (!contact) {
      throw createHostsError('Host contact not found', 404, 'HOST_CONTACT_NOT_FOUND', { contactId: id });
    }

    // Audit log
    await AuditLogger.logEntityChange(
      'host_contacts',
      String(id),
      oldContact,
      contact,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    // Re-geocode synchronously if address changed
    const addressChanged = updates.address && updates.address !== oldContact.address;
    let finalContact = contact;
    if (addressChanged) {
      try {
        const coords = await geocodeAddress(updates.address);
        if (coords) {
          const updated = await storage.updateHostContact(id, {
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          if (updated) {
            finalContact = updated;
          }
          logger.info(`✅ Re-geocoded host contact ${id}: ${updates.address}`);
        } else {
          logger.warn(`⚠️ Geocoding returned no results for contact ${id}: ${updates.address}`);
        }
      } catch (err) {
        logger.error(`Failed to re-geocode host contact ${id}:`, err);
      }
    }

    // Keep the linked volunteer record in step with "Also a volunteer"
    await syncHostContactVolunteer(finalContact);

    res.json(finalContact);
  })
);

  router.delete(
  '/host-contacts/:id',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  asyncHandler(async (req: any, res) => {
    const id = validateId(req.params.id, 'host contact');

    // Get old data before delete
    const oldContact = await storage.getHostContact(id);
    if (!oldContact) {
      throw createHostsError('Host contact not found', 404, 'HOST_CONTACT_NOT_FOUND', { contactId: id });
    }

    const success = await storage.deleteHostContact(id);

    if (!success) {
      throw createHostsError('Host contact not found', 404, 'HOST_CONTACT_NOT_FOUND', { contactId: id });
    }

    // Their volunteer record (if any) stays — they may still volunteer
    await unlinkHostContactVolunteer(id);

    // Audit log
    await AuditLogger.logDelete(
      'host_contacts',
      String(id),
      oldContact,
      {
        userId: req.user?.id || req.session?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        sessionId: req.sessionID
      }
    );

    res.status(204).send();
  })
);

// Weekly availability scraper endpoint
  router.post(
  '/scrape-availability',
  requirePermission(PERMISSIONS.HOSTS_EDIT),
  asyncHandler(async (req, res) => {
    const result = await scrapeHostAvailability();

    if (result.success) {
      res.json({
        message: 'Host availability updated successfully',
        ...result,
      });
    } else {
      throw createHostsError(
        'Host availability scrape failed',
        500,
        'SCRAPE_FAILED',
        { scrapeResult: result }
      );
    }
  })
);

  // Add error handling middleware for all routes
  router.use(hostsErrorHandler());

  return router;
}

