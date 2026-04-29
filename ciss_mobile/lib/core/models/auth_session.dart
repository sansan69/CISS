import 'app_role.dart';

class AuthSession {
  const AuthSession({
    required this.role,
    required this.displayName,
    required this.primaryId,
    this.token,
    this.employeeDocId,
    this.assignedDistricts = const <String>[],
  });

  final AppRole role;
  final String displayName;
  final String primaryId;
  final String? token;
  final String? employeeDocId;
  final List<String> assignedDistricts;
}

