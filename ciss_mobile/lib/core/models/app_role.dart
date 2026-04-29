enum AppRole {
  guard,
  fieldOfficer,
}

extension AppRoleLabel on AppRole {
  String get label {
    switch (this) {
      case AppRole.guard:
        return 'Guard';
      case AppRole.fieldOfficer:
        return 'Field Officer';
    }
  }
}

