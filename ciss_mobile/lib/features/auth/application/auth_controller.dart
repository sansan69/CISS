import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/app_role.dart';
import '../../../core/models/auth_session.dart';

final StateProvider<AuthSession?> authSessionProvider =
    StateProvider<AuthSession?>((Ref ref) => null);

class AuthController {
  AuthController(this._ref);

  final Ref _ref;

  void signInAsGuard() {
    _ref.read(authSessionProvider.notifier).state = const AuthSession(
          role: AppRole.guard,
          displayName: 'Demo Guard',
          primaryId: 'CISS/DEMO/2026/001',
          employeeDocId: 'demo-employee',
        );
  }

  void signInAsFieldOfficer() {
    _ref.read(authSessionProvider.notifier).state = const AuthSession(
          role: AppRole.fieldOfficer,
          displayName: 'Demo Field Officer',
          primaryId: 'fo-demo-001',
          assignedDistricts: <String>['Ernakulam', 'Thrissur'],
        );
  }

  void signOut() {
    _ref.read(authSessionProvider.notifier).state = null;
  }
}

final Provider<AuthController> authControllerProvider =
    Provider<AuthController>((Ref ref) => AuthController(ref));

